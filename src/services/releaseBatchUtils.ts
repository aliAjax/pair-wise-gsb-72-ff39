import type {
  AudienceRule,
  BatchCandidate,
  BatchGateCode,
  BatchRestorePoint,
  CandidateSnapshot,
  Dependency,
  Environment,
  FeatureFlag,
  RolloutStep,
} from '@/types'
import type { Database } from '@/services/database'

export const ENV_ORDER: Environment[] = ['dev', 'staging', 'production']

export const environmentRank = (environment: Environment): number => ENV_ORDER.indexOf(environment)

export const environmentLabel: Record<Environment, string> = {
  dev: '开发',
  staging: '预发',
  production: '生产',
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * 来源指纹只覆盖候选要保留的四要素：受众、依赖开关、来源环境最低客户端版本、灰度阶段。
 * 候选确认前任一来源变化都会让指纹失配，候选立即失效。
 */
export const computeSourceFingerprint = (flag: FeatureFlag): string => {
  const payload = {
    audienceRules: flag.audienceRules,
    dependencies: flag.dependencies,
    minClientVersion: flag.minClientVersion[flag.environment],
    rolloutSteps: flag.rolloutSteps,
  }
  const raw = stableStringify(payload)
  let hash = 5381
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 33 + raw.charCodeAt(index)) >>> 0
  }
  return `fp-${hash.toString(16).padStart(8, '0')}`
}

export const buildCandidateSnapshot = (flag: FeatureFlag): CandidateSnapshot => ({
  audienceRules: clone(flag.audienceRules),
  dependencies: clone(flag.dependencies),
  minClientVersion: flag.minClientVersion[flag.environment],
  rolloutSteps: clone(flag.rolloutSteps),
  rolloutPercentage: flag.rolloutPercentage,
  sourceFingerprint: computeSourceFingerprint(flag),
})

export const isCandidateStale = (candidate: BatchCandidate, sourceFlag: FeatureFlag | undefined): boolean => {
  if (!sourceFlag) return true
  return computeSourceFingerprint(sourceFlag) !== candidate.snapshot.sourceFingerprint
}

export const compareVersions = (left: string, right: string): number => {
  const parse = (version: string) =>
    version
      .trim()
      .split('.')
      .map((segment) => Number.parseInt(segment, 10) || 0)
  const leftParts = parse(left)
  const rightParts = parse(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export const bumpPatchVersion = (version: string): string => {
  const parts = version.trim().split('.')
  const patch = Number.parseInt(parts[2] ?? '0', 10) || 0
  return `${parts[0] ?? '1'}.${parts[1] ?? '0'}.${patch + 1}`
}

export interface GateResult {
  code: BatchGateCode
  detail: string
}

/**
 * 在目标环境解析依赖开关：优先找同 key 的目标环境记录（跨环境晋升后的依赖），
 * 找不到时退回被引用的原记录。
 */
const resolveDependencyFlag = (
  db: Database,
  dependency: Dependency,
  targetEnvironment: Environment,
): FeatureFlag | undefined => {
  const referenced = db.flags.find((flag) => flag.id === dependency.flagId)
  if (!referenced) return undefined
  return (
    db.flags.find((flag) => flag.key === referenced.key && flag.environment === targetEnvironment) ??
    referenced
  )
}

const evaluateEnvironmentOrderGate = (
  db: Database,
  flagKey: string,
  targetEnvironment: Environment,
): GateResult | null => {
  const rank = environmentRank(targetEnvironment)
  if (rank === 0) return null
  const predecessorEnvironment = ENV_ORDER[rank - 1]
  const predecessor = db.flags.find(
    (flag) => flag.key === flagKey && flag.environment === predecessorEnvironment,
  )
  if (!predecessor) {
    return {
      code: 'environment-order',
      detail: `${environmentLabel[predecessorEnvironment]}环境尚无同开关发布记录，不能跨环境推进到${environmentLabel[targetEnvironment]}。`,
    }
  }
  if (predecessor.status === 'rolled-back' || predecessor.rolloutPercentage <= 0) {
    return {
      code: 'environment-order',
      detail: `${environmentLabel[predecessorEnvironment]}环境未放量或已回滚（当前 ${predecessor.rolloutPercentage}%），环境顺序冲突，整批停止。`,
    }
  }
  return null
}

const evaluateDependencyGate = (
  db: Database,
  dependencies: Dependency[],
  targetEnvironment: Environment,
): GateResult | null => {
  for (const dependency of dependencies) {
    if (dependency.type !== 'requires') continue
    const target = resolveDependencyFlag(db, dependency, targetEnvironment)
    if (!target) {
      return {
        code: 'dependency-missing',
        detail: `前置依赖 ${dependency.condition || dependency.flagId} 在${environmentLabel[targetEnvironment]}环境不存在。`,
      }
    }
    if (target.status === 'rolled-back' || (!target.enabled && target.status !== 'frozen')) {
      return {
        code: target.status === 'rolled-back' ? 'dependency-rolled-back' : 'dependency-disabled',
        detail: `前置依赖 ${target.key} 在${environmentLabel[targetEnvironment]}环境已${target.status === 'rolled-back' ? '回滚' : `关闭（${target.status}）`}：${dependency.condition}。`,
      }
    }
  }
  return null
}

const evaluateVersionGate = (
  baselines: Record<Environment, string>,
  candidate: BatchCandidate,
): GateResult | null => {
  const baseline = baselines[candidate.targetEnvironment]
  if (compareVersions(baseline, candidate.snapshot.minClientVersion) < 0) {
    return {
      code: 'version-unsatisfied',
      detail: `候选要求最低客户端 ${candidate.snapshot.minClientVersion}，${environmentLabel[candidate.targetEnvironment]}在线基线仅 ${baseline}，低版本客户端会命中不支持的新逻辑。`,
    }
  }
  return null
}

/** 对单个候选实时执行全部发布门禁；返回 null 表示放行。 */
export const evaluateCandidateGate = (
  db: Database,
  baselines: Record<Environment, string>,
  flagKey: string,
  candidate: BatchCandidate,
  sourceFlag: FeatureFlag | undefined,
): GateResult | null => {
  if (isCandidateStale(candidate, sourceFlag)) {
    return {
      code: 'stale-source',
      detail: `来源${environmentLabel[candidate.sourceEnvironment]}的受众、依赖、最低客户端版本或灰度阶段在候选确认后发生变化，候选已失效，请重新生成。`,
    }
  }
  const orderGate = evaluateEnvironmentOrderGate(db, flagKey, candidate.targetEnvironment)
  if (orderGate) return orderGate
  const dependencyGate = evaluateDependencyGate(db, candidate.snapshot.dependencies, candidate.targetEnvironment)
  if (dependencyGate) return dependencyGate
  return evaluateVersionGate(baselines, candidate)
}

/**
 * 把候选快照晋升到目标环境开关：只覆盖候选保留的受众、依赖、最低客户端版本、灰度阶段，
 * 同时记录晋升前的受众/依赖/阶段作为回滚恢复点。
 */
export const promoteFlagIntoEnvironment = (
  db: Database,
  sourceFlag: FeatureFlag,
  candidate: BatchCandidate,
  actor: string,
  timestamp: string,
): { target: FeatureFlag; restorePoint: BatchRestorePoint } => {
  const existingIndex = db.flags.findIndex(
    (flag) => flag.key === sourceFlag.key && flag.environment === candidate.targetEnvironment,
  )

  const promotedDependencies = candidate.snapshot.dependencies.map((dependency) => {
    const resolved = resolveDependencyFlag(db, dependency, candidate.targetEnvironment)
    return resolved ? { ...dependency, flagId: resolved.id } : dependency
  })

  if (existingIndex >= 0) {
    const existing = db.flags[existingIndex]
    const restorePoint: BatchRestorePoint = {
      audienceRules: clone(existing.audienceRules),
      dependencies: clone(existing.dependencies),
      rolloutSteps: clone(existing.rolloutSteps),
      targetExisted: true,
    }
    const target: FeatureFlag = {
      ...existing,
      audienceRules: clone(candidate.snapshot.audienceRules) as AudienceRule[],
      dependencies: promotedDependencies as Dependency[],
      rolloutSteps: clone(candidate.snapshot.rolloutSteps) as RolloutStep[],
      rolloutPercentage: candidate.snapshot.rolloutPercentage,
      minClientVersion: {
        ...existing.minClientVersion,
        [candidate.targetEnvironment]: candidate.snapshot.minClientVersion,
      },
      enabled: true,
      status: 'active',
      updatedAt: timestamp,
      lastChangedBy: actor,
    }
    db.flags[existingIndex] = target
    return { target, restorePoint }
  }

  const restorePoint: BatchRestorePoint = {
    audienceRules: [],
    dependencies: [],
    rolloutSteps: [],
    targetExisted: false,
  }
  const target: FeatureFlag = {
    ...clone(sourceFlag),
    id: candidate.targetFlagId,
    environment: candidate.targetEnvironment,
    audienceRules: clone(candidate.snapshot.audienceRules),
    dependencies: promotedDependencies,
    rolloutSteps: clone(candidate.snapshot.rolloutSteps),
    rolloutPercentage: candidate.snapshot.rolloutPercentage,
    minClientVersion: {
      ...sourceFlag.minClientVersion,
      [candidate.targetEnvironment]: candidate.snapshot.minClientVersion,
    },
    enabled: true,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastChangedBy: actor,
  }
  db.flags.push(target)
  return { target, restorePoint }
}

/** 整批回滚：只恢复候选恢复点中的受众、依赖和灰度阶段，其余字段保持发布后的值。 */
export const restoreCandidateFromPoint = (
  db: Database,
  candidate: BatchCandidate,
  actor: string,
  timestamp: string,
): FeatureFlag | undefined => {
  const restorePoint = candidate.restorePoint
  if (!restorePoint) return undefined
  if (!restorePoint.targetExisted) {
    const index = db.flags.findIndex((flag) => flag.id === candidate.targetFlagId)
    if (index >= 0) db.flags.splice(index, 1)
    return undefined
  }
  const index = db.flags.findIndex((flag) => flag.id === candidate.targetFlagId)
  if (index < 0) return undefined
  const flag = db.flags[index]
  const restored: FeatureFlag = {
    ...flag,
    audienceRules: clone(restorePoint.audienceRules),
    dependencies: clone(restorePoint.dependencies),
    rolloutSteps: clone(restorePoint.rolloutSteps),
    updatedAt: timestamp,
    lastChangedBy: actor,
  }
  db.flags[index] = restored
  return restored
}
