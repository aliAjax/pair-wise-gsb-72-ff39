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
  createdAt: string
  updatedAt: string
  lastChangedBy: string
}

export interface AuditEvent {
  id: string
  flagId: string
  flagKey: string
  batchId?: string
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
    | 'batch-confirmed'
    | 'batch-applied'
    | 'batch-halted'
    | 'batch-retried'
    | 'batch-superseded'
    | 'batch-rolled-back'
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

export type BatchStatus =
  | 'draft'
  | 'confirmed'
  | 'applied'
  | 'halted'
  | 'rolled-back'
  | 'superseded'

export type BatchCandidateStatus =
  | 'pending'
  | 'applied'
  | 'failed'
  | 'invalidated'
  | 'skipped'
  | 'rolled-back'

export type BatchGateCode =
  | 'stale-source'
  | 'environment-order'
  | 'dependency-rolled-back'
  | 'dependency-disabled'
  | 'dependency-missing'
  | 'version-unsatisfied'

export interface CandidateSnapshot {
  audienceRules: AudienceRule[]
  dependencies: Dependency[]
  minClientVersion: string
  rolloutSteps: RolloutStep[]
  rolloutPercentage: number
  sourceFingerprint: string
}

export interface BatchRestorePoint {
  audienceRules: AudienceRule[]
  dependencies: Dependency[]
  rolloutSteps: RolloutStep[]
  targetExisted: boolean
}

export interface BatchCandidate {
  id: string
  sourceEnvironment: Environment
  targetEnvironment: Environment
  status: BatchCandidateStatus
  snapshot: CandidateSnapshot
  restorePoint?: BatchRestorePoint
  targetFlagId: string
  blockingCode?: BatchGateCode
  blockingDetail?: string
  appliedAt?: string
}

export interface ReleaseBatch {
  id: string
  flagId: string
  flagKey: string
  flagName: string
  status: BatchStatus
  createdBy: string
  createdAt: string
  confirmedAt?: string
  confirmedBy?: string
  appliedAt?: string
  haltedAt?: string
  rollbackAt?: string
  rollbackBy?: string
  rollbackReason?: string
  candidates: BatchCandidate[]
  note?: string
}
