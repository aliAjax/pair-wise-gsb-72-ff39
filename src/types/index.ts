export type FlagStatus = 'draft' | 'review' | 'active' | 'frozen' | 'rolled-back'
export type Environment = 'dev' | 'staging' | 'production'
export type RuleOperator = 'equals' | 'not-equals' | 'contains' | 'in' | 'gte' | 'lte'
export type IssueSeverity = 'blocker' | 'warning' | 'info'
export type IssueCategory =
  | 'rule-conflict'
  | 'dead-code'
  | 'missing-metric'
  | 'overlap'
  | 'client-compatibility'

export interface AudienceRule {
  id: string
  attribute: string
  operator: RuleOperator
  value: string
  negate: boolean
}

export interface RolloutStep {
  id: string
  percentage: number
  audience: string
  startedAt: string
  status: 'completed' | 'running' | 'planned' | 'paused'
  guardrails: string[]
}

export interface Dependency {
  flagId: string
  type: 'requires' | 'conflicts' | 'fallback'
  condition: string
}

/** 单个环境上的开关状态。同一开关在不同环境可处于不同生命周期阶段。 */
export interface EnvironmentState {
  environment: Environment
  status: FlagStatus
  enabled: boolean
  rolloutPercentage: number
  /** 该环境当前生效的受众规则，发布批次以此为来源/回滚锚点。 */
  audienceRules: AudienceRule[]
  /** 该环境当前生效的依赖关系。 */
  dependencies: Dependency[]
  /** 该环境当前所处的灰度阶段。 */
  rolloutSteps: RolloutStep[]
  /** 该环境要求的最低客户端版本。 */
  minClientVersion: string
  updatedAt: string
}

export interface FeatureFlag {
  id: string
  key: string
  name: string
  description: string
  owner: string
  team: string
  status: FlagStatus
  environment: Environment
  enabled: boolean
  rolloutPercentage: number
  audienceRules: AudienceRule[]
  regions: string[]
  minClientVersion: Record<Environment, string>
  dependencies: Dependency[]
  rollbackConditions: string[]
  metricNames: string[]
  deadCodeStatus: 'clean' | 'candidate' | 'confirmed'
  rolloutSteps: RolloutStep[]
  /** 每个环境各自的发布状态；顶层字段保持为主环境快照，兼容既有页面。 */
  environmentStates: Partial<Record<Environment, EnvironmentState>>
  createdAt: string
  updatedAt: string
  lastChangedBy: string
}

/** 候选冻结下来的开关配置（受众、依赖、最低客户端版本、灰度阶段）。 */
export interface CandidateSnapshot {
  audienceRules: AudienceRule[]
  dependencies: Dependency[]
  minClientVersion: string
  rolloutPercentage: number
  rolloutSteps: RolloutStep[]
}

export type CandidateStatus =
  | 'prepared' // 已从来源生成不可变候选，等待确认
  | 'stale' // 来源在确认前发生变化，候选已失效
  | 'confirmed' // 已随批次确认，内容锁定
  | 'applied' // 已成功写入目标环境
  | 'failed' // 写入失败，可凭保留的未完成项重试
  | 'skipped' // 整批在此前停下，尚未执行
  | 'rolled-back'

export type BatchStatus =
  | 'prepared' // 候选已生成，等待确认
  | 'confirmed' // 已确认，可执行发布
  | 'running' // 发布执行中
  | 'applied' // 全部环境写入成功
  | 'halted' // 预检不通过或写入失败，整批停下
  | 'rolled-back'

export interface ReleaseCandidate {
  id: string
  sourceEnvironment: Environment
  targetEnvironment: Environment
  status: CandidateStatus
  /** 冻结的不可变配置；重新生成候选时整体替换。 */
  snapshot: CandidateSnapshot
  /** 快照内容指纹，用于展示与溯源。 */
  snapshotHash: string
  /** 生成快照时来源的指纹，用于检测确认前来源漂移。 */
  sourceFingerprint: string
  /** 写入前目标环境的锚点，整批回滚只恢复候选内字段时作为参照。 */
  preApplyAnchor?: CandidateSnapshot
  /** 写入失败或预检中断时保留的原因。 */
  failureReason?: string
  preparedAt: string
  confirmedAt?: string
  appliedAt?: string
}

export interface ReleaseBatch {
  id: string
  flagId: string
  flagKey: string
  status: BatchStatus
  /** 有序目标环境链，严格按 dev → staging → production 推进。 */
  candidates: ReleaseCandidate[]
  createdBy: string
  createdAt: string
  confirmedAt?: string
  haltedAt?: string
  haltReason?: string
  appliedAt?: string
  rolledBackAt?: string
  rollbackReason?: string
}

export type CheckCode =
  | 'dependency-rolled-back' // 前置依赖已被回滚
  | 'dependency-version' // 前置依赖最低客户端版本高于候选
  | 'conflict-active' // 互斥开关在目标环境仍启用
  | 'version-regression' // 候选最低版本低于目标环境当前最低版本
  | 'environment-order' // 环境顺序/链路状态冲突

export type CheckSeverity = 'blocker' | 'warning'

export interface PreflightFinding {
  candidateId: string
  code: CheckCode
  severity: CheckSeverity
  message: string
}

export interface CreateBatchInput {
  flagId: string
  /** 选中的来源环境，按发布顺序排列（如 staging 表示 staging→production）。 */
  sources: Environment[]
  createdBy: string
}

export interface AuditEvent {
  id: string
  flagId: string
  flagKey: string
  action:
    | 'created'
    | 'updated'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'frozen'
    | 'unfrozen'
    | 'rolled-back'
    | 'rollout-adjusted'
    | 'batch-created'
    | 'batch-candidate-stale'
    | 'batch-regenerated'
    | 'batch-confirmed'
    | 'batch-applied'
    | 'batch-halted'
    | 'batch-retried'
    | 'batch-rolled-back'
  /** 批次类审计事件关联的发布批次。 */
  batchId?: string
  /** 批次类事件关联的具体候选（目标环境）。 */
  targetEnvironment?: Environment
  actor: string
  summary: string
  before?: string
  after?: string
  affectedUsers: number
  createdAt: string
}

export interface ImpactIssue {
  id: string
  flagId: string
  flagKey: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  detail: string
  suggestion: string
  resolved: boolean
}

export interface DashboardData {
  activeFlags: number
  pendingReview: number
  blockerIssues: number
  affectedUsers: number
  environmentDiff: Array<{ flag: string; dev: number; staging: number; production: number }>
  adoptionTrend: Array<{ date: string; flags: number; rollbacks: number }>
}

export interface FlagFilter {
  keyword?: string
  status?: FlagStatus | ''
  environment?: Environment | ''
  team?: string
  owner?: string
}

export interface ReviewPayload {
  reviewer: string
  decision: 'approved' | 'rejected'
  comment: string
  freezeUntil?: string
}
