/* 端到端逻辑验证：多环境发布批次。运行方式见 package 无关的临时打包命令。 */
import { readDatabase, writeDatabase } from '@/services/database'
import {
  applyReleaseBatch,
  armNextWriteFailure,
  confirmReleaseBatch,
  createReleaseBatch,
  refreshBatchFreshness,
  regenerateBatchCandidates,
  retryReleaseBatch,
  rollbackReleaseBatch,
  saveEnvBaseline,
  simulateSourceDrift,
} from '@/services/releaseBatches'

const store = new Map<string, string>()
const localStorageShim = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
}
;(globalThis as { localStorage: typeof localStorageShim }).localStorage = localStorageShim

let passed = 0
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`断言失败：${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}
const reset = () => {
  store.clear()
  const db = readDatabase()
  db.releaseBatches = []
  writeDatabase(db)
}
const resetWithSeeds = () => {
  store.clear()
  readDatabase()
}
const findFlag = (key: string, environment: string) =>
  readDatabase().flags.find((flag) => flag.key === key && flag.environment === environment)
const findBatch = (id: string) => readDatabase().releaseBatches.find((batch) => batch.id === id)!

// --- 场景 A：创建去重、确认前来源变化失效、重生、确认、晋升、整批回滚 ---
console.log('场景 A：候选失效与整批回滚只恢复受众/依赖/阶段')
reset()
const created = createReleaseBatch({ flagId: 'flag-101', targets: ['production'], actor: '发布经理' })
assert(!created.superseded, '首次创建批次成功')
const batchId = created.batch.id
const snapshotBefore = JSON.stringify(findBatch(batchId).candidates[0].snapshot)

const duplicate = createReleaseBatch({ flagId: 'flag-101', targets: ['production'], actor: '发布经理' })
assert(duplicate.superseded && duplicate.batch.id === batchId, '两个窗口同时提交同一开关只保留既有批次')

simulateSourceDrift('flag-101', '陈思远')
const staleBatch = refreshBatchFreshness(batchId)
assert(staleBatch.candidates[0].status === 'invalidated', '来源最低版本变化后，未确认候选立即失效')
assert(JSON.stringify(findBatch(batchId).candidates[0].snapshot) === snapshotBefore, '失效候选的旧快照保持不可变')

let confirmThrew = false
try {
  confirmReleaseBatch(batchId, '林默')
} catch {
  confirmThrew = true
}
assert(confirmThrew, '存在失效候选时确认被拒绝')

regenerateBatchCandidates(batchId, '林默')
confirmReleaseBatch(batchId, '林默')
saveEnvBaseline('production', '8.19.0')
applyReleaseBatch(batchId, '林默')
const productionFlag = findFlag('checkout.express-pay-v2', 'production')!
assert(productionFlag.status === 'active' && productionFlag.rolloutPercentage === 20, '晋升后生产开关 active / 20%')
assert(productionFlag.audienceRules.length === 3, '生产受众按候选恢复为 3 条（旧生产记录原为 0 条）')
assert(productionFlag.minClientVersion.production === '8.18.1', '生产最低客户端按候选写为漂移后的 8.18.1')
assert(productionFlag.rolloutSteps.length === 4, '生产灰度阶段按候选写为 4 个')
assert(productionFlag.dependencies.some((dep) => dep.flagId === 'flag-104'), '依赖重映射到生产环境的支付聚合路由')

rollbackReleaseBatch(batchId, '林默', '生产支付成功率跌破阈值，执行整批回滚验证。')
const restored = findFlag('checkout.express-pay-v2', 'production')!
assert(restored.audienceRules.length === 0, '回滚只恢复候选恢复点：受众回到旧生产记录的 0 条')
assert(restored.rolloutSteps.length === 1, '回滚恢复旧灰度阶段（1 个计划阶段）')
assert(restored.dependencies.length === 1, '回滚恢复旧依赖（仅支付聚合，无互斥项）')
assert(restored.minClientVersion.production === '8.18.1', '回滚不恢复最低客户端版本，仍为发布后的 8.18.1')
assert(restored.status === 'active', '回滚不改变开关状态字段')
const auditA = readDatabase().audit.filter((event) => event.batchId === batchId)
assert(auditA.some((event) => event.action === 'batch-applied'), '发布审计保留可查')
assert(auditA.some((event) => event.action === 'batch-rolled-back'), '整批回滚审计保留可查')

// --- 场景 B：写入失败保留未完成项，重试从断点继续 ---
console.log('场景 B：写入失败保留断点并重试')
reset()
armNextWriteFailure()
const b = createReleaseBatch({ flagId: 'flag-101', targets: ['production'], actor: '发布经理' })
confirmReleaseBatch(b.batch.id, '林默')
applyReleaseBatch(b.batch.id, '林默')
let db = readDatabase()
let halted = db.releaseBatches.find((item) => item.id === b.batch.id)!
let prod = db.flags.find((flag) => flag.key === 'checkout.express-pay-v2' && flag.environment === 'production')!
assert(halted.status === 'halted', '写入失败后整批状态为 halted')
assert(halted.candidates[0].status === 'failed', '失败候选标记为 failed 且保留在批次中')
assert(prod.status === 'review' && prod.rolloutPercentage === 0, '失败写入未落盘，生产记录保持原值')

retryReleaseBatch(b.batch.id, '林默')
db = readDatabase()
halted = db.releaseBatches.find((item) => item.id === b.batch.id)!
prod = db.flags.find((flag) => flag.key === 'checkout.express-pay-v2' && flag.environment === 'production')!
assert(halted.status === 'applied', '重试成功后批次完成')
assert(halted.candidates[0].status === 'applied', '保留的未完成项重试后变为已发布')
assert(prod.rolloutPercentage === 20 && prod.audienceRules.length === 3, '重试按候选写入生产')

// --- 场景 C：依赖在目标环境被回滚，整批停止 ---
console.log('场景 C：依赖回滚门禁')
resetWithSeeds()
retryReleaseBatch('batch-2', '林默')
db = readDatabase()
const batch2 = db.releaseBatches.find((item) => item.id === 'batch-2')!
assert(batch2.status === 'halted', '生产前置依赖（异步队列）已回滚，整批停止')
assert(batch2.candidates[1].blockingCode === 'dependency-rolled-back', '阻断原因为 dependency-rolled-back')
assert(batch2.candidates[0].status === 'applied', '已写入预发的候选不受影响，不重复发布')
assert(!db.flags.some((flag) => flag.key === 'console.billing-export-v3' && flag.environment === 'production'), '生产未创建任何记录')

// --- 场景 D：环境顺序冲突 ---
console.log('场景 D：环境顺序门禁')
reset()
const d = createReleaseBatch({ flagId: 'flag-103', targets: ['staging'], actor: '周航' })
confirmReleaseBatch(d.batch.id, '林默')
applyReleaseBatch(d.batch.id, '林默')
const dbD = readDatabase()
const batchD = dbD.releaseBatches.find((item) => item.id === d.batch.id)!
assert(batchD.status === 'halted', '上游开发环境未放量时不能晋升预发')
assert(batchD.candidates[0].blockingCode === 'environment-order', '阻断原因为 environment-order')

// --- 场景 E：版本不满足 ---
console.log('场景 E：最低客户端版本门禁')
reset()
saveEnvBaseline('production', '8.10.0')
const e = createReleaseBatch({ flagId: 'flag-101', targets: ['production'], actor: '陈思远' })
confirmReleaseBatch(e.batch.id, '林默')
applyReleaseBatch(e.batch.id, '林默')
const batchE = readDatabase().releaseBatches.find((item) => item.id === e.batch.id)!
assert(batchE.status === 'halted', '候选最低版本高于在线基线时整批停止')
assert(batchE.candidates[0].blockingCode === 'version-unsatisfied', '阻断原因为 version-unsatisfied')

// --- 场景 F：新建目标记录的整批回滚会移除记录 ---
console.log('场景 F：回滚移除发布时新建的目标记录')
reset()
const f = createReleaseBatch({ flagId: 'flag-112', targets: ['production'], actor: '孟卓' })
confirmReleaseBatch(f.batch.id, '林默')
applyReleaseBatch(f.batch.id, '林默')
assert(Boolean(findFlag('console.audit-export-v2', 'production')), '发布时新建了生产记录')
rollbackReleaseBatch(f.batch.id, '林默', '验证新建记录的整批回滚路径。')
assert(!findFlag('console.audit-export-v2', 'production'), '回滚移除发布时新建的生产记录')
assert(findFlag('console.audit-export-v2', 'staging')?.rolloutPercentage === 100, '同开关其他环境记录不受影响')

// --- 场景 G：确认后来源变化，执行时整批停止 ---
console.log('场景 G：确认后来源漂移执行时停止')
reset()
const g = createReleaseBatch({ flagId: 'flag-101', targets: ['production'], actor: '陈思远' })
confirmReleaseBatch(g.batch.id, '林默')
simulateSourceDrift('flag-101', '陈思远')
applyReleaseBatch(g.batch.id, '林默')
const batchG = readDatabase().releaseBatches.find((item) => item.id === g.batch.id)!
assert(batchG.status === 'halted', '确认后来源变化，执行时整批停止')
assert(batchG.candidates[0].blockingCode === 'stale-source', '阻断原因为 stale-source')

console.log(`\n全部 ${passed} 项断言通过。`)
void writeDatabase
