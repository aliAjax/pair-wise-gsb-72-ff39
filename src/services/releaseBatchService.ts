import {
  BATCH_FAILURE_KEY,
  clone,
  getEnvironmentState,
  readDatabase,
  syncHomeState,
  toCandidateSnapshot,
  writeDatabase,
} from '@/services/database'
import type {
  AuditEvent,
  CandidateSnapshot,
  CandidateStatus,
  CreateBatchInput,
  Environment,
  EnvironmentState,
  FeatureFlag,
  PreflightFinding,
  ReleaseBatch,
  ReleaseCandidate,
} from '@/types'

const ENVIRONMENT_ORDER: Environment[] = ['dev', 'staging', 'production']

export const nextEnvironment = (environment: Environment): Environment =>
  ENVIRONMENT_ORDER[ENVIRONMENT_ORDER.indexOf(environment) + 1]

const targetOf = (source: Environment): Environment => {
  if (source === 'production') throw new Error('生产环境不能继续向上发布')
  return nextEnvironment(source)
}

export const environmentLabel: Record<Environment, string> = {
  dev: 'DEV',
  staging: 'STAGING',
  production: 'PRODUCTION',
}

/** 稳定序列化（键排序），避免对象键顺序导致指纹抖动。 */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** djb2 指纹，标识候选/环境状态内容。 */
export const fingerprintOf = (value: unknown): string => {
  const text = stableStringify(value)
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const environmentFingerprint = (state: EnvironmentState): string =>
  fingerprintOf({
    audienceRules: state.audienceRules,
    dependencies: state.dependencies,
    minClientVersion: state.minClientVersion,
    rolloutPercentage: state.rolloutPercentage,
    rolloutSteps: state.rolloutSteps,
  })

const snapshotOfState = (state: EnvironmentState): CandidateSnapshot => toCandidateSnapshot(state)

const newAuditId = () => `audit-${Date.now()}-${Math.round(Math.random() * 1e6)}`
const newBatchId = () => `batch-${Date.now()}-${Math.round(Math.random() * 1000)}`
const newCandidateId = () => `cand-${Date.now()}-${Math.round(Math.random() * 1000)}`

const addAudit = (
  db: ReturnType<typeof readDatabase>,
  event: Omit<AuditEvent, 'id' | 'createdAt'>,
): void => {
  db.audit.unshift({
    id: newAuditId(),
    createdAt: new Date().toISOString(),
    ...event,
  })
}

/** 同一开关 + 同一有序目标环境链视为同一发布意图（去重键）。 */
export const batchSignature = (flagId: string, sources: Environment[]): string =>
  `${flagId}->${sources.map(targetOf).join('>')}`

const openStatuses = ['prepared', 'confirmed', 'running', 'halted']
const findOpenBatch = (db: ReturnType<typeof readDatabase>, input: CreateBatchInput): ReleaseBatch | undefined =>
  db.batches.find(
    (batch) =>
      batch.flagId === input.flagId &&
      openStatuses.includes(batch.status) &&
      batchSignature(batch.flagId, batch.candidates.map((candidate) => candidate.sourceEnvironment)) ===
        batchSignature(input.flagId, input.sources),
  )

/** 两个窗口同时提交：跨标签用 localStorage 锁串行化，同一发布意图只保留一个批次。 */
const LOCK_KEY = 'feature-flag-release-batch-create-lock'
const LOCK_TTL_MS = 4000
const LOCK_WAIT_MS = 1200

export const isCreateLocked = (): boolean => {
  const raw = localStorage.getItem(LOCK_KEY)
  if (!raw) return false
  const lock = JSON.parse(raw) as { at: number }
  if (Date.now() - lock.at > LOCK_TTL_MS) {
    localStorage.removeItem(LOCK_KEY)
    return false
  }
  return true
}

const acquireCreateLock = (): boolean => {
  if (isCreateLocked()) return false
  localStorage.setItem(LOCK_KEY, JSON.stringify({ at: Date.now() }))
  // 双标签同刻写入时复核一次，保证只有一个写锁生效。
  const current = localStorage.getItem(LOCK_KEY)
  if (!current) return false
  const lock = JSON.parse(current) as { at: number }
  return Date.now() - lock.at < LOCK_TTL_MS
}

const releaseCreateLock = (): void => localStorage.removeItem(LOCK_KEY)

const waitForLock = () => new Promise((resolve) => window.setTimeout(resolve, 250))

const validateSources = (sources: Environment[]): void => {
  if (sources.length === 0) throw new Error('至少选择一个来源环境')
  if (new Set(sources).size !== sources.length) throw new Error('同一环境不能在批次中重复出现')
  sources.forEach((source, index) => {
    if (source === 'production') throw new Error('生产环境不能作为发布来源')
    if (index > 0 && sources[index - 1] !== ENVIRONMENT_ORDER[ENVIRONMENT_ORDER.indexOf(source) - 1]) {
      throw new Error('环境必须按 DEV → STAGING → PRODUCTION 连续推进，不能跳级或乱序')
    }
  })
}

const buildCandidate = (
  flag: FeatureFlag,
  source: Environment,
  createdAt: string,
): ReleaseCandidate => {
  const sourceState = getEnvironmentState(flag, source)
  const snapshot = snapshotOfState(sourceState)
  return {
    id: newCandidateId(),
    sourceEnvironment: source,
    targetEnvironment: targetOf(source),
    status: 'prepared',
    snapshot,
    snapshotHash: fingerprintOf(snapshot),
    sourceFingerprint: environmentFingerprint(sourceState),
    preparedAt: createdAt,
  }
}

/** 刷新候选失效状态：确认前任一来源变化即失效。确认后的候选不再受来源漂移影响。 */
export const refreshStaleness = (
  flag: FeatureFlag | undefined,
  candidates: ReleaseCandidate[],
): ReleaseCandidate[] =>
  candidates.map((candidate) => {
    if (candidate.status !== 'prepared' || !flag) return candidate
    const currentFingerprint = environmentFingerprint(getEnvironmentState(flag, candidate.sourceEnvironment))
    if (currentFingerprint !== candidate.sourceFingerprint) return { ...candidate, status: 'stale' }
    return candidate
  })

export interface CreateBatchResult {
  batch: ReleaseBatch
  deduplicated: boolean
}

/**
 * 生成发布批次。返回 deduplicated=true 表示命中“两个窗口同时提交”，
 * 只保留先到的那个批次，调用方复用而不是新建。
 */
export const createBatch = async (input: CreateBatchInput): Promise<CreateBatchResult> => {
  validateSources(input.sources)

  // 等待跨标签锁最多 1.2s，随后读取先到窗口是否已落库。
  let waited = 0
  while (isCreateLocked() && waited < LOCK_WAIT_MS) {
    await waitForLock()
    waited += 250
  }
  {
    const db = readDatabase()
    const existing = findOpenBatch(db, input)
    if (existing) return { batch: existing, deduplicated: true }
  }

  if (!acquireCreateLock()) {
    // 锁可能来自另一窗口（真并发）或本窗口极短时间的第二次提交；等待并复查，尽量复用而非报错。
    let innerWait = 0
    while (isCreateLocked() && innerWait < LOCK_WAIT_MS) {
      await waitForLock()
      innerWait += 250
    }
    const db = readDatabase()
    const existing = findOpenBatch(db, input)
    if (existing) return { batch: existing, deduplicated: true }
    if (isCreateLocked()) throw new Error('另一个窗口正在提交同一发布，请稍后重试')
  }

  try {
    const db = readDatabase()
    const flag = db.flags.find((item) => item.id === input.flagId)
    if (!flag) throw new Error('功能开关不存在')
    const existing = findOpenBatch(db, input)
    if (existing) return { batch: existing, deduplicated: true }

    const createdAt = new Date().toISOString()
    const batch: ReleaseBatch = {
      id: newBatchId(),
      flagId: flag.id,
      flagKey: flag.key,
      status: 'prepared',
      candidates: input.sources.map((source) => buildCandidate(flag, source, createdAt)),
      createdBy: input.createdBy,
      createdAt,
    }
    db.batches.unshift(batch)
    addAudit(db, {
      flagId: flag.id,
      flagKey: flag.key,
      batchId: batch.id,
      action: 'batch-created',
      actor: input.createdBy,
      summary: `从 ${input.sources.map((source) => environmentLabel[source]).join('、')} 生成不可变发布候选，等待确认。`,
      affectedUsers: 0,
    })
    writeDatabase(db)
    return { batch, deduplicated: false }
  } finally {
    releaseCreateLock()
  }
}

/** 读取批次时同步来源漂移，并把检测到的失效写入审计（只记一次）。 */
export const listBatches = (): ReleaseBatch[] => {
  const db = readDatabase()
  let changed = false
  db.batches.forEach((batch) => {
    const flag = db.flags.find((item) => item.id === batch.flagId)
    const next = refreshStaleness(flag, batch.candidates)
    next.forEach((candidate, index) => {
      if (
        candidate.status === 'stale' &&
        batch.candidates[index].status === 'prepared'
      ) {
        changed = true
        addAudit(db, {
          flagId: batch.flagId,
          flagKey: batch.flagKey,
          batchId: batch.id,
          targetEnvironment: candidate.targetEnvironment,
          action: 'batch-candidate-stale',
          actor: '系统',
          summary: `候选 ${environmentLabel[candidate.sourceEnvironment]} → ${environmentLabel[candidate.targetEnvironment]} 的来源在确认前发生变化，候选已失效，需重新生成。`,
          affectedUsers: 0,
        })
      }
    })
    if (next.some((candidate, index) => candidate !== batch.candidates[index])) {
      batch.candidates = next
      changed = true
    }
  })
  if (changed) writeDatabase(db)
  return clone(db.batches)
}

/** 重新生成失效候选：从当前来源重新冻结快照。 */
export const regenerateCandidate = (batchId: string, candidateId: string, actor: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (!['prepared'].includes(batch.status)) throw new Error('批次已确认，候选不能重新生成')
  const flag = db.flags.find((item) => item.id === batch.flagId)
  if (!flag) throw new Error('功能开关不存在')
  const index = batch.candidates.findIndex((candidate) => candidate.id === candidateId)
  if (index < 0) throw new Error('候选不存在')
  if (batch.candidates[index].status !== 'stale') throw new Error('只有失效候选需要重新生成')

  const regenerated = buildCandidate(flag, batch.candidates[index].sourceEnvironment, new Date().toISOString())
  batch.candidates[index] = regenerated
  addAudit(db, {
    flagId: batch.flagId,
    flagKey: batch.flagKey,
    batchId: batch.id,
    targetEnvironment: regenerated.targetEnvironment,
    action: 'batch-regenerated',
    actor,
    summary: `从 ${environmentLabel[regenerated.sourceEnvironment]} 重新冻结候选（新指纹 ${regenerated.snapshotHash}）。`,
    affectedUsers: 0,
  })
  writeDatabase(db)
  return clone(batch)
}

/** 确认批次：存在失效候选则拒绝；确认后候选内容锁定。 */
export const confirmBatch = (batchId: string, actor: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'prepared') throw new Error('只有待确认批次可以确认')
  const flag = db.flags.find((item) => item.id === batch.flagId)
  batch.candidates = refreshStaleness(flag, batch.candidates)
  const stale = batch.candidates.filter((candidate) => candidate.status === 'stale')
  if (stale.length > 0) throw new Error('存在已失效候选，请重新生成后再确认')

  const now = new Date().toISOString()
  batch.status = 'confirmed'
  batch.confirmedAt = now
  batch.candidates.forEach((candidate) => {
    candidate.status = 'confirmed'
    candidate.confirmedAt = now
  })
  addAudit(db, {
    flagId: batch.flagId,
    flagKey: batch.flagKey,
    batchId: batch.id,
    action: 'batch-confirmed',
    actor,
    summary: `批次已确认，${batch.candidates.length} 个候选内容锁定：受众、依赖、最低客户端版本与灰度阶段不可变。`,
    affectedUsers: 0,
  })
  writeDatabase(db)
  return clone(batch)
}

/** 语义版本比较：a > b 返回 1，相等 0，a < b 返回 -1。 */
export const compareVersions = (a: string, b: string): number => {
  const partsOf = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const pa = partsOf(a)
  const pb = partsOf(b)
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] ?? 0) - (pb[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/**
 * 发布前预检。任一阻断项都会让整批停下：
 * - 环境顺序冲突（确认后来源再变化 / 目标已被改动）
 * - 前置依赖被回滚
 * - 前置依赖最低客户端版本高于候选（版本不满足）
 * - 候选最低版本低于目标当前最低版本（版本倒退）
 * - 互斥开关在目标仍启用
 */
export const runPreflight = (batchId: string): PreflightFinding[] => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  const flag = db.flags.find((item) => item.id === batch.flagId)
  if (!flag) throw new Error('功能开关不存在')

  const findings: PreflightFinding[] = []
  batch.candidates.forEach((candidate) => {
    if (candidate.status === 'applied' || candidate.status === 'rolled-back') return
    const push = (finding: Omit<PreflightFinding, 'candidateId'>) =>
      findings.push({ candidateId: candidate.id, ...finding })

    // 1. 环境顺序/链路状态：确认后来源漂移、目标被旁路改动都视为顺序冲突。
    const liveSource = getEnvironmentState(flag, candidate.sourceEnvironment)
    if (environmentFingerprint(liveSource) !== candidate.sourceFingerprint) {
      push({
        code: 'environment-order',
        severity: 'blocker',
        message: `${environmentLabel[candidate.sourceEnvironment]} 来源在候选确认后发生变化，环境链路状态与锁定候选冲突，整批停止。`,
      })
    }
    const liveTarget = getEnvironmentState(flag, candidate.targetEnvironment)
    if (
      liveTarget.rolloutPercentage !== 0 &&
      liveTarget.rolloutPercentage >= candidate.snapshot.rolloutPercentage &&
      compareVersions(liveTarget.minClientVersion, candidate.snapshot.minClientVersion) > 0
    ) {
      push({
        code: 'environment-order',
        severity: 'blocker',
        message: `${environmentLabel[candidate.targetEnvironment]} 已存在更高版本的在途发布，不能按本批次顺序覆盖。`,
      })
    }

    // 2/3. 前置依赖：已回滚则阻断；最低客户端版本高于候选也阻断。
    candidate.snapshot.dependencies
      .filter((dependency) => dependency.type === 'requires')
      .forEach((dependency) => {
        const dependencyFlag = db.flags.find((item) => item.id === dependency.flagId)
        if (!dependencyFlag) return
        const dependencyTarget = getEnvironmentState(dependencyFlag, candidate.targetEnvironment)
        if (dependencyTarget.status === 'rolled-back' || !dependencyTarget.enabled) {
          push({
            code: 'dependency-rolled-back',
            severity: 'blocker',
            message: `前置依赖「${dependencyFlag.name}」在 ${environmentLabel[candidate.targetEnvironment]} 已${
              dependencyTarget.status === 'rolled-back' ? '回滚' : '未启用'
            }，不能带着该候选继续发布。`,
          })
        }
        if (compareVersions(dependencyTarget.minClientVersion, candidate.snapshot.minClientVersion) > 0) {
          push({
            code: 'dependency-version',
            severity: 'blocker',
            message: `前置依赖「${dependencyFlag.name}」要求最低客户端 ${dependencyTarget.minClientVersion}，高于候选的 ${candidate.snapshot.minClientVersion}，版本不满足。`,
          })
        }
      })

    // 4. 互斥开关在目标仍启用。
    candidate.snapshot.dependencies
      .filter((dependency) => dependency.type === 'conflicts')
      .forEach((dependency) => {
        const conflictFlag = db.flags.find((item) => item.id === dependency.flagId)
        if (!conflictFlag) return
        const conflictTarget = getEnvironmentState(conflictFlag, candidate.targetEnvironment)
        if (conflictTarget.enabled && conflictTarget.status === 'active') {
          push({
            code: 'conflict-active',
            severity: 'blocker',
            message: `互斥开关「${conflictFlag.name}」在 ${environmentLabel[candidate.targetEnvironment]} 仍处于启用状态。`,
          })
        }
      })

    // 5. 版本倒退：候选最低版本低于目标当前门槛。
    if (compareVersions(candidate.snapshot.minClientVersion, liveTarget.minClientVersion) < 0) {
      push({
        code: 'version-regression',
        severity: 'blocker',
        message: `候选最低客户端版本 ${candidate.snapshot.minClientVersion} 低于 ${environmentLabel[candidate.targetEnvironment]} 当前门槛 ${liveTarget.minClientVersion}，发布将造成版本倒退。`,
      })
    }
  })
  return findings
}

export interface ApplyBatchResult {
  batch: ReleaseBatch
  findings: PreflightFinding[]
}

/** 把候选快照写入目标环境的开关状态（只动环境状态及其受众/依赖/阶段/版本）。 */
const writeCandidate = (
  db: ReturnType<typeof readDatabase>,
  flag: FeatureFlag,
  candidate: ReleaseCandidate,
  batchId: string,
  actor: string,
): void => {
  const target = candidate.targetEnvironment
  const previous = getEnvironmentState(flag, target)
  // 记录写入前锚点，供回滚参照。
  candidate.preApplyAnchor = snapshotOfState(previous)

  const snapshot = candidate.snapshot
  const nextState: EnvironmentState = {
    environment: target,
    status: 'active',
    enabled: true,
    rolloutPercentage: snapshot.rolloutPercentage,
    audienceRules: clone(snapshot.audienceRules),
    dependencies: clone(snapshot.dependencies),
    rolloutSteps: clone(snapshot.rolloutSteps),
    minClientVersion: snapshot.minClientVersion,
    updatedAt: new Date().toISOString(),
  }
  flag.environmentStates[target] = nextState
  flag.minClientVersion[target] = snapshot.minClientVersion
  if (flag.environment === target) {
    // 目标即开关主环境：顶层字段是该环境的既有页面视图，同步为候选内容。
    flag.status = 'active'
    flag.enabled = true
    flag.rolloutPercentage = snapshot.rolloutPercentage
    flag.audienceRules = clone(snapshot.audienceRules)
    flag.dependencies = clone(snapshot.dependencies)
    flag.rolloutSteps = clone(snapshot.rolloutSteps)
  }
  flag.updatedAt = nextState.updatedAt

  addAudit(db, {
    flagId: flag.id,
    flagKey: flag.key,
    batchId,
    targetEnvironment: target,
    action: 'batch-applied',
    actor,
    summary: `候选 ${environmentLabel[candidate.sourceEnvironment]} → ${environmentLabel[target]} 已写入：受众 ${snapshot.audienceRules.length} 条、依赖 ${snapshot.dependencies.length} 项、灰度 ${snapshot.rolloutPercentage}%、最低版本 ${snapshot.minClientVersion}。`,
    affectedUsers: Math.round(900000 * (snapshot.rolloutPercentage / 100)),
  })
}

/** 顺序执行批次：遇到第一个阻断项或写入失败立即整批停下，剩余候选保留为未完成项。 */
export const applyBatch = (batchId: string, actor: string): ApplyBatchResult => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  if (!['confirmed', 'halted'].includes(batch.status)) throw new Error('当前批次状态不能执行发布')

  const flag = db.flags.find((item) => item.id === batch.flagId)
  if (!flag) throw new Error('功能开关不存在')

  // 重试场景：把上次跳过的未完成项复位，失败项也重新参与预检。
  batch.candidates.forEach((candidate) => {
    if (candidate.status === 'skipped' || candidate.status === 'failed') {
      candidate.status = 'confirmed'
      candidate.failureReason = undefined
    }
  })
  batch.status = 'running'
  batch.haltReason = undefined
  const findings = runPreflight(batchId)
  const findingsByCandidate = new Map<string, PreflightFinding[]>()
  findings.forEach((finding) => {
    const list = findingsByCandidate.get(finding.candidateId) ?? []
    list.push(finding)
    findingsByCandidate.set(finding.candidateId, list)
  })

  let halted = false
  const ordered = [...batch.candidates].sort(
    (a, b) =>
      ENVIRONMENT_ORDER.indexOf(a.targetEnvironment) - ENVIRONMENT_ORDER.indexOf(b.targetEnvironment),
  )

  for (const candidate of ordered) {
    const candidateStatus: CandidateStatus = candidate.status
    if (candidateStatus === 'applied') continue
    const blockers = (findingsByCandidate.get(candidate.id) ?? []).filter(
      (finding) => finding.severity === 'blocker',
    )
    if (blockers.length > 0 || halted) {
      halted = true
      if (candidate.status !== 'applied') candidate.status = 'skipped'
      continue
    }
    try {
      const willFail = localStorage.getItem(BATCH_FAILURE_KEY) === candidate.targetEnvironment
      if (willFail) {
        localStorage.removeItem(BATCH_FAILURE_KEY)
        throw new Error('配置服务写入超时（模拟失败）')
      }
      writeCandidate(db, flag, candidate, batch.id, actor)
      candidate.status = 'applied'
      candidate.appliedAt = new Date().toISOString()
    } catch (error) {
      candidate.status = 'failed'
      candidate.failureReason = error instanceof Error ? error.message : '写入失败'
      halted = true
    }
  }

  if (halted) {
    batch.status = 'halted'
    batch.haltedAt = new Date().toISOString()
    const firstBlocker = ordered
      .map((candidate) => findingsByCandidate.get(candidate.id)?.[0])
      .find((finding) => finding?.severity === 'blocker')
    const failed = ordered.find((candidate) => candidate.status === 'failed')
    batch.haltReason = failed?.failureReason ?? firstBlocker?.message ?? '发布在中途停止'
    addAudit(db, {
      flagId: batch.flagId,
      flagKey: batch.flagKey,
      batchId: batch.id,
      action: 'batch-halted',
      actor: '系统',
      summary: `整批停止：${batch.haltReason} 未完成候选已保留，可从保留项重试。`,
      affectedUsers: 0,
    })
  } else if (batch.candidates.every((candidate) => candidate.status === 'applied')) {
    batch.status = 'applied'
    batch.appliedAt = new Date().toISOString()
  } else {
    batch.status = 'halted'
  }

  writeDatabase(db)
  return { batch: clone(batch), findings }
}

/**
 * 整批回滚：按目标环境倒序，仅把每个候选对应环境的
 * 受众规则、依赖开关、灰度阶段（及灰度比例/启停）恢复到写入前锚点，
 * 不动最低客户端版本与其它字段，不删除任何历史审计。
 */
export const rollbackBatch = (batchId: string, actor: string, reason: string): ReleaseBatch => {
  if (reason.trim().length < 8) throw new Error('回滚原因至少 8 个字符')
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === batchId)
  if (!batch) throw new Error('发布批次不存在')
  const applied = batch.candidates.filter(
    (candidate) => candidate.status === 'applied' || candidate.status === 'failed',
  )
  if (applied.length === 0) throw new Error('批次中没有已写入的环境，无需回滚')
  const flag = db.flags.find((item) => item.id === batch.flagId)
  if (!flag) throw new Error('功能开关不存在')

  const reversed = [...applied].sort(
    (a, b) =>
      ENVIRONMENT_ORDER.indexOf(b.targetEnvironment) - ENVIRONMENT_ORDER.indexOf(a.targetEnvironment),
  )
  reversed.forEach((candidate) => {
    const target = candidate.targetEnvironment
    // 回滚锚点：写入前目标环境自身的内容；候选写入失败（未生成锚点）时用当前环境状态兜底。
    const anchor = candidate.preApplyAnchor ?? snapshotOfState(getEnvironmentState(flag, target))
    const state = getEnvironmentState(flag, target)
    // 只恢复候选覆盖的三类内容：受众、依赖、灰度阶段（阶段携带灰度比例与启停）。
    state.audienceRules = clone(anchor.audienceRules)
    state.dependencies = clone(anchor.dependencies)
    state.rolloutSteps = clone(anchor.rolloutSteps)
    state.rolloutPercentage = anchor.rolloutPercentage
    state.status = 'rolled-back'
    state.enabled = false
    state.updatedAt = new Date().toISOString()
    flag.environmentStates[target] = state
    if (flag.environment === target) {
      flag.status = 'rolled-back'
      flag.enabled = false
      flag.rolloutPercentage = anchor.rolloutPercentage
      flag.audienceRules = clone(anchor.audienceRules)
      flag.dependencies = clone(anchor.dependencies)
      flag.rolloutSteps = clone(anchor.rolloutSteps)
    }
    flag.updatedAt = state.updatedAt
    candidate.status = 'rolled-back'

    addAudit(db, {
      flagId: flag.id,
      flagKey: flag.key,
      batchId: batch.id,
      targetEnvironment: target,
      action: 'batch-rolled-back',
      actor,
      summary: `回滚 ${environmentLabel[target]}：仅恢复发布前锚点中的受众（${anchor.audienceRules.length} 条）、依赖（${anchor.dependencies.length} 项）与灰度阶段（${anchor.rolloutSteps.length} 个、灰度 ${anchor.rolloutPercentage}%），最低客户端版本保持 ${state.minClientVersion} 不变；原审计仍保留可查。原因：${reason}`,
      affectedUsers: 0,
    })
  })

  batch.status = 'rolled-back'
  batch.rolledBackAt = new Date().toISOString()
  batch.rollbackReason = reason
  writeDatabase(db)
  return clone(batch)
}

/** 演示用：改动某环境（默认来源 staging），让未确认候选立即失效。 */
export const mutateSourceEnvironment = (
  flagId: string,
  environment: Environment,
  actor: string,
): ReleaseBatch[] => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const state = getEnvironmentState(flag, environment)
  state.minClientVersion = bumpPatch(state.minClientVersion)
  flag.minClientVersion[environment] = state.minClientVersion
  flag.environmentStates[environment] = state
  if (flag.environment === environment) syncHomeState(flag)
  addAudit(db, {
    flagId: flag.id,
    flagKey: flag.key,
    action: 'updated',
    actor,
    summary: `${environmentLabel[environment]} 来源依赖/最低客户端版本调整为 ${state.minClientVersion}，未确认候选将因此失效。`,
    after: state.minClientVersion,
    affectedUsers: 0,
  })
  writeDatabase(db)
  return listBatches()
}

/** 演示用：回滚某前置依赖在指定环境的发布，触发依赖回滚阻断。 */
export const rollbackDependencyForDemo = (
  dependencyFlagId: string,
  environment: Environment,
  actor: string,
): void => {
  const db = readDatabase()
  const dependency = db.flags.find((item) => item.id === dependencyFlagId)
  if (!dependency) throw new Error('依赖开关不存在')
  const state = getEnvironmentState(dependency, environment)
  state.status = 'rolled-back'
  state.enabled = false
  state.rolloutPercentage = 0
  state.rolloutSteps = state.rolloutSteps.map((step) =>
    step.status === 'running' ? { ...step, status: 'paused' } : step,
  )
  state.updatedAt = new Date().toISOString()
  // 空锚点是按需构造的临时对象，必须显式挂回才能持久化“未发布即被回滚”的状态。
  dependency.environmentStates[environment] = state
  if (dependency.environment === environment) {
    // 主环境：顶层字段即该环境视图，需同步，避免 syncHomeState 用旧顶层值覆盖。
    dependency.status = 'rolled-back'
    dependency.enabled = false
    dependency.rolloutPercentage = 0
    dependency.rolloutSteps = clone(state.rolloutSteps)
  }
  addAudit(db, {
    flagId: dependency.id,
    flagKey: dependency.key,
    action: 'rolled-back',
    actor,
    summary: `${environmentLabel[environment]} 依赖被回滚，引用它的发布批次预检将被阻断。`,
    after: 'rolled-back / 0%',
    affectedUsers: 0,
  })
  writeDatabase(db)
}

/** 演示用：抬高目标环境当前最低客户端版本，触发版本倒退/不满足。 */
export const raiseTargetMinVersion = (
  flagId: string,
  environment: Environment,
  actor: string,
): void => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const state = getEnvironmentState(flag, environment)
  state.minClientVersion = bumpMinor(state.minClientVersion)
  flag.minClientVersion[environment] = state.minClientVersion
  flag.environmentStates[environment] = state
  if (flag.environment === environment) syncHomeState(flag)
  addAudit(db, {
    flagId: flag.id,
    flagKey: flag.key,
    action: 'updated',
    actor,
    summary: `${environmentLabel[environment]} 当前最低客户端版本上调为 ${state.minClientVersion}，旧审核放行的候选将不满足版本要求。`,
    after: state.minClientVersion,
    affectedUsers: 0,
  })
  writeDatabase(db)
}

/** 演示用：预置下一次批次写入在指定环境失败。 */
export const armNextWriteFailure = (environment: Environment): void => {
  localStorage.setItem(BATCH_FAILURE_KEY, environment)
}

const bumpPatch = (version: string): string => {
  const parts = version.split('.')
  parts[parts.length - 1] = String((Number.parseInt(parts.at(-1) ?? '0', 10) || 0) + 1)
  return parts.join('.')
}

const bumpMinor = (version: string): string => {
  const parts = version.split('.')
  parts[1] = String((Number.parseInt(parts[1] ?? '0', 10) || 0) + 2)
  return parts.join('.')
}
