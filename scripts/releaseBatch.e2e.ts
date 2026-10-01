// 端到端领域测试：用最小 localStorage/window 垫片加载 TS 服务并验证发布批次生命周期。
// 运行：node --experimental-strip-types scripts/releaseBatch.e2e.ts
const store = new Map<string, string>()
const localStorageShim = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
}
;(globalThis as Record<string, unknown>).localStorage = localStorageShim
;(globalThis as Record<string, unknown>).window = {
  setTimeout: (fn: () => void) => setTimeout(fn, 0),
}

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exitCode = 1
    throw new Error(message)
  }
  console.log(`✓ ${message}`)
}

const seed = (await import('../src/services/database.ts')).seedDatabase
const { writeDatabase, getEnvironmentState, BATCH_FAILURE_KEY } = await import('../src/services/database.ts')
const service = await import('../src/services/releaseBatchService.ts')

// 用种子数据初始化（含迁移）。
const migrated = (await import('../src/services/database.ts')).readDatabase()
assert(migrated.batches.length === 0, '迁移后批次表为空')
assert(Boolean(migrated.flags[0].environmentStates.staging), '迁移补齐主环境状态')

// 1. 生成 staging→production 批次（flag-101）。
const created = await service.createBatch({ flagId: 'flag-101', sources: ['staging'], createdBy: '测试' })
assert(!created.deduplicated, '首次创建不是去重复用')
const batchId = created.batch.id
assert(created.batch.candidates[0].status === 'prepared', '候选初始为待确认')
assert(created.batch.candidates[0].snapshotHash.length === 8, '候选带内容指纹')

// 2. 两个窗口同时提交同一发布 -> 只保留一个。
const duplicate = await service.createBatch({ flagId: 'flag-101', sources: ['staging'], createdBy: '窗口B' })
assert(duplicate.deduplicated && duplicate.batch.id === batchId, '并发/重复提交复用同一批次')

// 3. 确认前来源变化 -> 候选失效，确认被拒。
service.mutateSourceEnvironment('flag-101', 'staging', '发布经理')
let stale = service.listBatches().find((b) => b.id === batchId)!
assert(stale.candidates[0].status === 'stale', '来源变更后候选失效')
let confirmFailed = false
try {
  service.confirmBatch(batchId, '测试')
} catch {
  confirmFailed = true
}
assert(confirmFailed, '存在失效候选时确认被拒绝')

// 4. 重新生成 -> 可确认。
const regenerated = service.regenerateCandidate(batchId, stale.candidates[0].id, '测试')
assert(regenerated.candidates[0].status === 'prepared', '重新生成后候选回到待确认')
const confirmed = service.confirmBatch(batchId, '测试')
assert(confirmed.status === 'confirmed' && confirmed.candidates[0].status === 'confirmed', '批次与候选已确认锁定')

// 5. 确认后来源再变 + 依赖回滚 -> 预检阻断，整批停下。
service.mutateSourceEnvironment('flag-101', 'staging', '发布经理')
service.rollbackDependencyForDemo('flag-104', 'production', '平台')
let findings = service.runPreflight(batchId)
const codes = findings.map((f) => f.code)
assert(codes.includes('environment-order'), '预检报环境顺序冲突')
assert(codes.includes('dependency-rolled-back'), '预检报依赖已回滚')
let applied = service.applyBatch(batchId, '测试')
assert(applied.batch.status === 'halted', '阻断时整批停止')
assert(applied.batch.candidates[0].status === 'skipped', '未执行候选保留为未完成项')

// 6. 修复来源（从 staging 重新对齐无法自动完成，用“重新生成”只允许 prepared；
//    这里直接验证：未修复时重试仍停止）。
applied = service.applyBatch(batchId, '测试')
assert(applied.batch.status === 'halted', '问题未修复前重试仍停止')

// 7. 用一个干净批次验证写入失败 -> failed 保留 -> 重试成功。
//    先把 staging 指纹对齐回候选：重新构造一个全新批次（当前 staging 状态即来源）。
const fresh = await service.createBatch({ flagId: 'flag-101', sources: ['staging'], createdBy: '测试2' })
// 第一个批次还在 halted，同签名会去重；改用不同链路前先关闭旧批次（回滚）。
assert(fresh.deduplicated === true, '旧批次未结束时同链路创建仍去重')

// 先把旧批次回滚（无 applied，预期拒绝），改用把旧批次来源对齐：
// 直接在数据层把 staging 恢复为候选指纹对应的内容不易构造；改为回滚依赖并新建单环境批次演示失败/重试。
// 恢复依赖 flag-104 生产为启用。
{
  const dbModule = await import('../src/services/database.ts')
  const db = dbModule.readDatabase()
  const dep = db.flags.find((f) => f.id === 'flag-104')!
  dep.environmentStates.production = {
    environment: 'production',
    status: 'active',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    dependencies: [],
    rolloutSteps: [],
    minClientVersion: dep.minClientVersion.production,
    updatedAt: new Date().toISOString(),
  }
  dbModule.writeDatabase(db)
}

// 旧批次 staging 指纹仍漂移；直接对它再跑预检确认 dependency 已解除但 order 仍在。
findings = service.runPreflight(batchId)
assert(!findings.some((f) => f.code === 'dependency-rolled-back'), '依赖恢复后依赖阻断消失')
assert(findings.some((f) => f.code === 'environment-order'), '来源漂移的顺序冲突仍在')

// 8. 版本不满足：抬高生产最低版本。
service.raiseTargetMinVersion('flag-101', 'production', '评审人')
findings = service.runPreflight(batchId)
assert(findings.some((f) => f.code === 'version-regression'), '生产抬高版本后报版本倒退')

// 9. 写入失败 + 重试：构造一个能通过预检的全新批次。
//    让旧批次结束：直接数据层把它标记 rolled-back 不可行（需要 applied）。
//    改为选择另一个开关 flag-103（dev→staging）走失败/重试路径。
{
  const dbModule = await import('../src/services/database.ts')
  const db = dbModule.readDatabase()
  // flag-103 依赖 flag-107，需要 staging 的依赖处于启用态。
  const dep = db.flags.find((f) => f.id === 'flag-107')!
  dep.environmentStates.staging = {
    environment: 'staging',
    status: 'active',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    dependencies: [],
    rolloutSteps: [{ id: 'q701', percentage: 100, audience: '预发长任务', startedAt: '2026-09-22T09:00:00+08:00', status: 'completed', guardrails: [] }],
    minClientVersion: dep.minClientVersion.staging,
    updatedAt: new Date().toISOString(),
  }
  dbModule.writeDatabase(db)
}
const batch3 = await service.createBatch({ flagId: 'flag-103', sources: ['dev'], createdBy: '测试3' })
assert(!batch3.deduplicated, '不同链路/开关可独立建批')
const batch3Id = batch3.batch.id
service.confirmBatch(batch3Id, '测试3')
assert(service.runPreflight(batch3Id).filter((f) => f.severity === 'blocker').length === 0, 'flag-103 dev→staging 预检通过')

localStorageShim.setItem(BATCH_FAILURE_KEY, 'staging')
let ran3 = service.applyBatch(batch3Id, '测试3')
assert(ran3.batch.status === 'halted', '注入写入失败后批次停止')
assert(ran3.batch.candidates[0].status === 'failed', '失败候选保留 failed 与原因')
assert(Boolean(ran3.batch.candidates[0].failureReason), '失败原因已保留')

// 清除可能的残留失败开关，重试应成功。
localStorageShim.removeItem(BATCH_FAILURE_KEY)
ran3 = service.applyBatch(batch3Id, '测试3')
assert(ran3.batch.status === 'applied', '从保留的未完成项重试后整批完成')
assert(ran3.batch.candidates[0].status === 'applied', '重试候选成功写入')

// 10. 验证写入内容：staging 现在等于候选快照。
{
  const dbModule = await import('../src/services/database.ts')
  const db = dbModule.readDatabase()
  const flag = db.flags.find((f) => f.id === 'flag-103')!
  const staging = getEnvironmentState(flag, 'staging')
  assert(staging.enabled === true && staging.status === 'active', 'staging 已启用')
  assert(staging.audienceRules.length === 1, 'staging 受众来自候选快照')
}

// 11. 整批回滚：只恢复受众/依赖/阶段到写入前锚点（空），审计保留。
{
  const dbModule = await import('../src/services/database.ts')
  const beforeAudit = dbModule.readDatabase().audit.length
  const rolled = service.rollbackBatch(batch3Id, '测试3', '指标异常触发整批回滚验证')
  assert(rolled.status === 'rolled-back', '批次已回滚')
  const db = dbModule.readDatabase()
  const flag = db.flags.find((f) => f.id === 'flag-103')!
  const staging = getEnvironmentState(flag, 'staging')
  assert(staging.enabled === false && staging.status === 'rolled-back', '回滚后目标关闭')
  assert(staging.audienceRules.length === 0, '回滚只恢复写入前锚点的受众（空）')
  assert(staging.minClientVersion === '5.10.0', '回滚不改最低客户端版本')
  assert(db.audit.length >= beforeAudit + 1, '回滚只追加审计，历史审计仍在')
  const batchEvents = db.audit.filter((e) => e.batchId === batch3Id).map((e) => e.action)
  assert(batchEvents.includes('batch-created'), '批次创建审计可查')
  assert(batchEvents.includes('batch-applied'), '候选写入审计可查')
  assert(batchEvents.includes('batch-rolled-back'), '批次回滚审计可查')
}

// 12. 环境顺序校验：乱序/跳级/生产来源被拒。
for (const bad of [
  { sources: ['production'] as const },
  { sources: ['staging', 'dev'] as const },
]) {
  let rejected = false
  try {
    await service.createBatch({ flagId: 'flag-103', sources: [...bad.sources], createdBy: 'x' })
  } catch {
    rejected = true
  }
  assert(rejected, `非法环境序列被拒绝: ${bad.sources.join(',')}`)
}

// 避免未使用告警（seed 仅用于类型/初始化说明）。
void seed
void writeDatabase
console.log('\n全部领域断言通过。')
