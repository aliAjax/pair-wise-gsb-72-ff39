import type {
  AuditEvent,
  BatchCandidate,
  Environment,
  FeatureFlag,
  ReleaseBatch,
} from '@/types'
import { readDatabase, writeDatabase, type Database } from '@/services/database'
import {
  ENV_ORDER,
  bumpPatchVersion,
  buildCandidateSnapshot,
  environmentRank,
  evaluateCandidateGate,
  isCandidateStale,
  promoteFlagIntoEnvironment,
  restoreCandidateFromPoint,
  type GateResult,
} from '@/services/releaseBatchUtils'

const ACTIVE_BATCH_STATUSES: ReleaseBatch['status'][] = ['draft', 'confirmed', 'applied', 'halted']

// 写入失败为一次性的会话级注入：模拟目标环境配置服务短暂不可用。
let armedWriteFailure = false
export const armNextWriteFailure = (): void => {
  armedWriteFailure = true
}

let sequence = 0
const uniqueId = (prefix: string): string => {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}

const now = (): string => new Date().toISOString()

const addAudit = (
  db: Database,
  event: Omit<AuditEvent, 'id' | 'createdAt' | 'affectedUsers'> & { affectedUsers?: number },
): void => {
  db.audit.unshift({
    id: uniqueId('audit'),
    createdAt: now(),
    affectedUsers: event.affectedUsers ?? 0,
    ...event,
  })
}

const findSourceFlag = (db: Database, batch: ReleaseBatch, candidate: BatchCandidate): FeatureFlag | undefined =>
  db.flags.find((flag) => flag.key === batch.flagKey && flag.environment === candidate.sourceEnvironment)

const sortedCandidates = (batch: ReleaseBatch): BatchCandidate[] =>
  [...batch.candidates].sort(
    (left, right) => environmentRank(left.targetEnvironment) - environmentRank(right.targetEnvironment),
  )

const candidateAffectedUsers = (candidate: BatchCandidate): number =>
  Math.round(900000 * (candidate.snapshot.rolloutPercentage / 100))

// ---------------------------------------------------------------------------
// 总览（带实时门禁预览，不改变数据）
// ---------------------------------------------------------------------------

export interface BatchCandidateView extends BatchCandidate {
  sourceFlagId?: string
  sourceFlagFound: boolean
  gate: GateResult | null
}

export interface ReleaseBatchView extends ReleaseBatch {
  candidates: BatchCandidateView[]
}

export interface ReleaseOverview {
  batches: ReleaseBatchView[]
  sourceFlags: FeatureFlag[]
  baselines: Record<Environment, string>
  writeFailureArmed: boolean
}

const decorateBatch = (db: Database, batch: ReleaseBatch): ReleaseBatchView => ({
  ...batch,
  candidates: sortedCandidates(batch).map((candidate) => {
    const sourceFlag = findSourceFlag(db, batch, candidate)
    const needsGate = candidate.status === 'pending' || candidate.status === 'failed' || candidate.status === 'invalidated'
    return {
      ...candidate,
      sourceFlagId: sourceFlag?.id,
      sourceFlagFound: Boolean(sourceFlag),
      gate: needsGate
        ? evaluateCandidateGate(db, db.envBaselines, batch.flagKey, candidate, sourceFlag)
        : null,
    }
  }),
})

export const getReleaseOverview = (): ReleaseOverview => {
  const db = readDatabase()
  const activeKeys = new Set(
    db.releaseBatches.filter((batch) => ACTIVE_BATCH_STATUSES.includes(batch.status)).map((batch) => batch.flagKey),
  )
  return {
    batches: [...db.releaseBatches]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((batch) => decorateBatch(db, batch)),
    sourceFlags: db.flags.filter(
      (flag) => !activeKeys.has(flag.key) && flag.environment !== 'production',
    ),
    baselines: db.envBaselines,
    writeFailureArmed: armedWriteFailure,
  }
}

// ---------------------------------------------------------------------------
// 创建批次：从选中环境生成不可变候选；两个窗口同时提交只保留一个
// ---------------------------------------------------------------------------

export interface CreateBatchInput {
  flagId: string
  targets: Environment[]
  actor: string
}

export interface CreateBatchResult {
  batch: ReleaseBatch
  superseded: boolean
}

export const createReleaseBatch = (input: CreateBatchInput): CreateBatchResult => {
  const db = readDatabase()
  const source = db.flags.find((flag) => flag.id === input.flagId)
  if (!source) throw new Error('来源开关不存在')

  const sourceRank = environmentRank(source.environment)
  const targets = [...new Set(input.targets)].sort((left, right) => environmentRank(left) - environmentRank(right))
  if (targets.length === 0) throw new Error('至少选择一个目标环境')
  if (targets.some((target) => environmentRank(target) <= sourceRank)) {
    throw new Error('目标环境必须位于来源环境下游，不能同环境或反向发布')
  }

  const existing = db.releaseBatches.find(
    (batch) => batch.flagKey === source.key && ACTIVE_BATCH_STATUSES.includes(batch.status),
  )
  if (existing) {
    addAudit(db, {
      flagId: source.id,
      flagKey: source.key,
      batchId: existing.id,
      action: 'batch-superseded',
      actor: input.actor,
      summary: `第二个提交窗口尝试为 ${source.key} 创建发布批次，检测到批次 ${existing.id} 仍在进行，仅保留既有批次。`,
      before: '重复提交',
      after: `合并至 ${existing.id}`,
    })
    writeDatabase(db)
    return { batch: existing, superseded: true }
  }

  const batchId = uniqueId('batch')
  const candidates: BatchCandidate[] = targets.map((target) => {
    const targetFlag = db.flags.find((flag) => flag.key === source.key && flag.environment === target)
    return {
      id: `${batchId}-cand-${target}`,
      sourceEnvironment: source.environment,
      targetEnvironment: target,
      status: 'pending',
      targetFlagId: targetFlag?.id ?? `${source.id}-${target}`,
      snapshot: buildCandidateSnapshot(source),
    }
  })

  const batch: ReleaseBatch = {
    id: batchId,
    flagId: source.id,
    flagKey: source.key,
    flagName: source.name,
    status: 'draft',
    createdBy: input.actor,
    createdAt: now(),
    candidates,
  }
  db.releaseBatches.push(batch)
  addAudit(db, {
    flagId: source.id,
    flagKey: source.key,
    batchId,
    action: 'batch-created',
    actor: input.actor,
    summary: `从${source.environment.toUpperCase()}生成发布批次，目标 ${targets.map((target) => target.toUpperCase()).join(' → ')}，候选已固化受众、依赖、最低客户端版本与灰度阶段。`,
    after: 'draft',
  })
  writeDatabase(db)
  return { batch, superseded: false }
}

// ---------------------------------------------------------------------------
// 候选新鲜度：确认前 / 执行前任一来源变化即失效
// ---------------------------------------------------------------------------

/** 依据当前来源重新校验草稿批次候选指纹，把已变化的候选标记为失效。
 *  已确认批次的候选不可变、不做失效改写；确认后的来源漂移在执行时由 stale-source 门禁整批停止。 */
export const refreshBatchFreshness = (batchId: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.releaseBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'draft') return batch
  batch.candidates = batch.candidates.map((candidate) => {
    if (candidate.status !== 'pending') return candidate
    const sourceFlag = findSourceFlag(db, batch, candidate)
    return isCandidateStale(candidate, sourceFlag)
      ? {
          ...candidate,
          status: 'invalidated',
          blockingCode: 'stale-source',
          blockingDetail: '来源环境的受众、依赖、最低客户端版本或灰度阶段在候选生成后发生变化。',
        }
      : candidate
  })
  writeDatabase(db)
  return batch
}

/** 草稿批次允许从最新来源重新生成失效候选，再次得到不可变快照。 */
export const regenerateBatchCandidates = (batchId: string, actor: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.releaseBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'draft') throw new Error('批次确认后候选不可重新生成，只能新建批次')
  batch.candidates = batch.candidates.map((candidate) => {
    if (candidate.status !== 'invalidated') return candidate
    const sourceFlag = findSourceFlag(db, batch, candidate)
    if (!sourceFlag) throw new Error('来源开关已不存在，无法重新生成')
    const targetFlag = db.flags.find((flag) => flag.key === batch.flagKey && flag.environment === candidate.targetEnvironment)
    return {
      ...candidate,
      status: 'pending',
      blockingCode: undefined,
      blockingDetail: undefined,
      targetFlagId: targetFlag?.id ?? candidate.targetFlagId,
      snapshot: buildCandidateSnapshot(sourceFlag),
    }
  })
  addAudit(db, {
    flagId: batch.flagId,
    flagKey: batch.flagKey,
    batchId,
    action: 'updated',
    actor,
    summary: '来源变化后重新生成发布候选，旧快照作废，新候选重新固化受众、依赖、版本与阶段。',
  })
  writeDatabase(db)
  return batch
}

// ---------------------------------------------------------------------------
// 确认批次：锁定不可变候选；存在失效候选则拒绝确认
// ---------------------------------------------------------------------------

export const confirmReleaseBatch = (batchId: string, actor: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.releaseBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'draft') throw new Error('只有草稿批次可以确认')

  let hasStale = false
  batch.candidates = batch.candidates.map((candidate) => {
    if (candidate.status === 'invalidated' || candidate.status === 'failed') {
      hasStale = true
      return candidate
    }
    if (candidate.status !== 'pending') return candidate
    const sourceFlag = findSourceFlag(db, batch, candidate)
    if (isCandidateStale(candidate, sourceFlag)) {
      hasStale = true
      return {
        ...candidate,
        status: 'invalidated',
        blockingCode: 'stale-source',
        blockingDetail: '来源环境的受众、依赖、最低客户端版本或灰度阶段在确认前发生变化。',
      }
    }
    return candidate
  })
  if (hasStale) {
    writeDatabase(db)
    throw new Error('候选已因来源变化失效，请重新生成后再确认')
  }

  batch.status = 'confirmed'
  batch.confirmedAt = now()
  batch.confirmedBy = actor
  addAudit(db, {
    flagId: batch.flagId,
    flagKey: batch.flagKey,
    batchId,
    action: 'batch-confirmed',
    actor,
    summary: `确认发布批次 ${batch.id}，候选快照不可变，后续按 ${ENV_ORDER.filter((env) =>
      batch.candidates.some((candidate) => candidate.targetEnvironment === env),
    ).map((env) => env.toUpperCase()).join(' → ')} 顺序逐环境发布。`,
    before: 'draft',
    after: 'confirmed',
  })
  writeDatabase(db)
  return batch
}

// ---------------------------------------------------------------------------
// 执行 / 重试：逐环境跑门禁；依赖回滚、版本不满足、顺序冲突整批停止
// ---------------------------------------------------------------------------

const haltBatch = (
  db: Database,
  batch: ReleaseBatch,
  candidate: BatchCandidate,
  gate: GateResult | null,
  actor: string,
  writeFailure?: string,
): void => {
  const index = batch.candidates.findIndex((item) => item.id === candidate.id)
  batch.candidates[index] = writeFailure
    ? { ...candidate, status: 'failed', blockingCode: undefined, blockingDetail: writeFailure }
    : {
        ...candidate,
        status: 'pending',
        blockingCode: gate?.code,
        blockingDetail: gate?.detail,
      }
  batch.status = 'halted'
  batch.haltedAt = now()
  addAudit(db, {
    flagId: batch.flagId,
    flagKey: batch.flagKey,
    batchId: batch.id,
    action: 'batch-halted',
    actor: writeFailure ? '系统' : actor,
    summary: writeFailure
      ? `写入${candidate.targetEnvironment.toUpperCase()}失败：${writeFailure} 未完成项已保留，可从断点重试。`
      : `${candidate.targetEnvironment.toUpperCase()}门禁未通过（${gate?.code ?? 'gate-blocked'}）：${gate?.detail ?? ''} 整批停止，后续环境不再发布。`,
    before: 'confirmed',
    after: 'halted',
  })
}

const runBatch = (batchId: string, actor: string, isRetry: boolean): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.releaseBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'confirmed' && batch.status !== 'halted') {
    throw new Error('当前批次状态不能执行发布')
  }

  if (isRetry) {
    addAudit(db, {
      flagId: batch.flagId,
      flagKey: batch.flagKey,
      batchId,
      action: 'batch-retried',
      actor,
      summary: `从保留的未完成项重试批次 ${batch.id}，已发布环境保持候选值，门禁按当前状态重新校验。`,
      before: 'halted',
      after: batch.status,
    })
  }

  for (const candidate of sortedCandidates(batch)) {
    if (candidate.status === 'applied' || candidate.status === 'skipped' || candidate.status === 'rolled-back') continue

    const sourceFlag = findSourceFlag(db, batch, candidate)
    const gate = evaluateCandidateGate(db, db.envBaselines, batch.flagKey, candidate, sourceFlag)
    if (gate) {
      haltBatch(db, batch, candidate, gate, actor)
      writeDatabase(db)
      return batch
    }
    if (!sourceFlag) throw new Error('来源开关已不存在，无法发布')

    const timestamp = now()
    const { target, restorePoint } = promoteFlagIntoEnvironment(db, sourceFlag, candidate, actor, timestamp)
    const appliedCandidate: BatchCandidate = {
      ...candidate,
      status: 'applied',
      restorePoint,
      blockingCode: undefined,
      blockingDetail: undefined,
      appliedAt: timestamp,
      targetFlagId: target.id,
    }
    const candidateIndex = batch.candidates.findIndex((item) => item.id === candidate.id)
    batch.candidates[candidateIndex] = appliedCandidate
    addAudit(db, {
      flagId: target.id,
      flagKey: batch.flagKey,
      batchId,
      action: 'batch-applied',
      actor,
      summary: `发布批次写入${candidate.targetEnvironment.toUpperCase()}：受众 ${appliedCandidate.snapshot.audienceRules.length} 条、依赖 ${appliedCandidate.snapshot.dependencies.length} 项、最低客户端 ${appliedCandidate.snapshot.minClientVersion}、${appliedCandidate.snapshot.rolloutSteps.length} 个灰度阶段按不可变候选生效。`,
      before: candidate.status === 'failed' ? 'failed（写入失败）' : 'pending',
      after: `active / ${target.rolloutPercentage}%`,
      affectedUsers: candidateAffectedUsers(appliedCandidate),
    })

    if (armedWriteFailure) {
      const reason = '目标环境配置服务返回 503（模拟写入失败）'
      armedWriteFailure = false
      // 丢弃全部内存变更，从已落盘的保留状态重建停滞批次。
      const persisted = readDatabase()
      const persistedBatch = persisted.releaseBatches.find((item) => item.id === batchId)
      const persistedCandidate = persistedBatch?.candidates.find((item) => item.id === candidate.id)
      if (persistedBatch && persistedCandidate) {
        haltBatch(persisted, persistedBatch, persistedCandidate, { code: 'version-unsatisfied', detail: '' }, actor, reason)
        writeDatabase(persisted)
        return persistedBatch
      }
      throw new Error(reason)
    }

    writeDatabase(db)
  }

  if (batch.candidates.every((candidate) => candidate.status === 'applied')) {
    batch.status = 'applied'
    batch.appliedAt = now()
    addAudit(db, {
      flagId: batch.flagId,
      flagKey: batch.flagKey,
      batchId,
      action: 'batch-applied',
      actor,
      summary: `发布批次 ${batch.id} 全部环境写入完成。`,
      before: 'confirmed',
      after: 'applied',
    })
    writeDatabase(db)
  }
  return batch
}

export const applyReleaseBatch = (batchId: string, actor: string): ReleaseBatch =>
  runBatch(batchId, actor, false)

export const retryReleaseBatch = (batchId: string, actor: string): ReleaseBatch =>
  runBatch(batchId, actor, true)

// ---------------------------------------------------------------------------
// 整批回滚：只恢复候选恢复点中的受众、依赖和灰度阶段，审计原样保留
// ---------------------------------------------------------------------------

export const rollbackReleaseBatch = (batchId: string, actor: string, reason: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.releaseBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (!['applied', 'halted', 'confirmed'].includes(batch.status)) {
    throw new Error('当前批次状态不支持整批回滚')
  }

  const applied = sortedCandidates(batch)
    .filter((candidate) => candidate.status === 'applied')
    .reverse()

  for (const candidate of applied) {
    const restored = restoreCandidateFromPoint(db, candidate, actor, now())
    const index = batch.candidates.findIndex((item) => item.id === candidate.id)
    batch.candidates[index] = { ...candidate, status: 'rolled-back' }
    addAudit(db, {
      flagId: restored?.id ?? candidate.targetFlagId,
      flagKey: batch.flagKey,
      batchId,
      action: 'batch-rolled-back',
      actor,
      summary: `整批回滚恢复${candidate.targetEnvironment.toUpperCase()}候选中的受众、依赖开关与灰度阶段${candidate.restorePoint?.targetExisted ? '' : '，发布时新建的目标记录已移除'}；最低客户端版本与开关状态不在恢复范围。原因：${reason}`,
      before: `active / ${candidate.snapshot.rolloutPercentage}%`,
      after: '候选恢复点',
      affectedUsers: candidateAffectedUsers(candidate),
    })
  }

  batch.candidates = batch.candidates.map((candidate) =>
    candidate.status === 'pending' || candidate.status === 'failed' ? { ...candidate, status: 'skipped' } : candidate,
  )
  batch.status = 'rolled-back'
  batch.rollbackAt = now()
  batch.rollbackBy = actor
  batch.rollbackReason = reason
  addAudit(db, {
    flagId: batch.flagId,
    flagKey: batch.flagKey,
    batchId,
    action: 'batch-rolled-back',
    actor,
    summary: `发布批次 ${batch.id} 整批回滚完成：仅恢复候选中的受众、依赖与阶段，发布与审批审计仍可查询。`,
    before: 'applied',
    after: 'rolled-back',
  })
  writeDatabase(db)
  return batch
}

// ---------------------------------------------------------------------------
// 演示辅助：模拟来源变化、环境版本基线调整
// ---------------------------------------------------------------------------

export const simulateSourceDrift = (flagId: string, actor: string): FeatureFlag => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const previous = flag.minClientVersion[flag.environment]
  const nextVersion = bumpPatchVersion(previous)
  flag.minClientVersion = { ...flag.minClientVersion, [flag.environment]: nextVersion }
  flag.updatedAt = now()
  flag.lastChangedBy = actor
  addAudit(db, {
    flagId: flag.id,
    flagKey: flag.key,
    action: 'updated',
    actor,
    summary: `来源${flag.environment.toUpperCase()}将最低客户端版本由 ${previous} 调整为 ${nextVersion}，未确认批次的候选需要重新校验。`,
    before: previous,
    after: nextVersion,
  })
  writeDatabase(db)
  return flag
}

export const saveEnvBaseline = (environment: Environment, version: string): EnvironmentBaselineResult => {
  const db = readDatabase()
  if (!/^\d+\.\d+\.\d+$/.test(version.trim())) throw new Error('版本号格式应为 x.y.z')
  const previous = db.envBaselines[environment]
  db.envBaselines = { ...db.envBaselines, [environment]: version.trim() }
  addAudit(db, {
    flagId: 'env-baseline',
    flagKey: `env-baseline.${environment}`,
    action: 'updated',
    actor: '林默',
    summary: `${environment.toUpperCase()}在线客户端覆盖基线由 ${previous} 调整为 ${version.trim()}，版本门禁按新基线重新判定。`,
    before: previous,
    after: version.trim(),
  })
  writeDatabase(db)
  return { baselines: db.envBaselines }
}

export interface EnvironmentBaselineResult {
  baselines: Record<Environment, string>
}
