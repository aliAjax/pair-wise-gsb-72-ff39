import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  applyReview,
  getDashboardStats,
  readDatabase,
  rollbackFlag,
  writeDatabase,
} from '@/services/database'
import {
  applyReleaseBatch,
  armNextWriteFailure,
  confirmReleaseBatch,
  createReleaseBatch,
  getReleaseOverview,
  refreshBatchFreshness,
  regenerateBatchCandidates,
  retryReleaseBatch,
  rollbackReleaseBatch,
  saveEnvBaseline,
  simulateSourceDrift,
  type ReleaseOverview,
} from '@/services/releaseBatches'
import type {
  AuditEvent,
  DashboardData,
  Environment,
  FeatureFlag,
  FlagFilter,
  ImpactIssue,
  ReviewPayload,
} from '@/types'

const delay = (milliseconds = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export const flagApi = createApi({
  reducerPath: 'flagApi',
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: ['Flags', 'Flag', 'Issues', 'Audit', 'Dashboard', 'ReleaseBatches'],
  endpoints: (builder) => ({
    getDashboard: builder.query<DashboardData, void>({
      async queryFn() {
        await delay()
        return { data: getDashboardStats() }
      },
      providesTags: ['Dashboard'],
    }),
    getFlags: builder.query<FeatureFlag[], FlagFilter>({
      async queryFn(filters) {
        await delay()
        const keyword = filters.keyword?.trim().toLowerCase()
        const data = readDatabase().flags.filter(
          (flag) =>
            (!filters.status || flag.status === filters.status) &&
            (!filters.environment || flag.environment === filters.environment) &&
            (!filters.team || flag.team === filters.team) &&
            (!filters.owner || flag.owner === filters.owner) &&
            (!keyword ||
              flag.name.toLowerCase().includes(keyword) ||
              flag.key.toLowerCase().includes(keyword) ||
              flag.owner.toLowerCase().includes(keyword)),
        )
        return { data }
      },
      providesTags: ['Flags'],
    }),
    getFlag: builder.query<FeatureFlag, string>({
      async queryFn(id) {
        await delay()
        const flag = readDatabase().flags.find((item) => item.id === id)
        return flag ? { data: flag } : { error: { message: '功能开关不存在' } }
      },
      providesTags: (_result, _error, id) => [{ type: 'Flag', id }],
    }),
    saveFlag: builder.mutation<FeatureFlag, FeatureFlag>({
      async queryFn(flag) {
        await delay(260)
        const db = readDatabase()
        const index = db.flags.findIndex((item) => item.id === flag.id)
        const next = { ...flag, updatedAt: new Date().toISOString() }
        if (index >= 0) {
          const before = db.flags[index]
          db.flags[index] = next
          db.audit.unshift({
            id: `audit-${Date.now()}`,
            flagId: flag.id,
            flagKey: flag.key,
            action: 'updated',
            actor: flag.lastChangedBy,
            summary: '更新开关受众、依赖、版本或回滚条件。',
            before: before.status,
            after: next.status,
            affectedUsers: Math.round(900000 * (next.rolloutPercentage / 100)),
            createdAt: new Date().toISOString(),
          })
        } else {
          db.flags.unshift(next)
          db.audit.unshift({
            id: `audit-${Date.now()}`,
            flagId: next.id,
            flagKey: next.key,
            action: 'created',
            actor: next.lastChangedBy,
            summary: '创建功能开关草稿。',
            after: next.status,
            affectedUsers: 0,
            createdAt: new Date().toISOString(),
          })
        }
        writeDatabase(db)
        return { data: next }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit'],
    }),
    submitForReview: builder.mutation<FeatureFlag, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(220)
        const db = readDatabase()
        const flag = db.flags.find((item) => item.id === id)
        if (!flag) return { error: { message: '功能开关不存在' } }
        flag.status = 'review'
        flag.updatedAt = new Date().toISOString()
        flag.lastChangedBy = actor
        db.audit.unshift({
          id: `audit-${Date.now()}`,
          flagId: id,
          flagKey: flag.key,
          action: 'submitted',
          actor,
          summary: '提交发布影响评审。',
          before: 'draft',
          after: 'review',
          affectedUsers: Math.round(900000 * (flag.rolloutPercentage / 100)),
          createdAt: new Date().toISOString(),
        })
        writeDatabase(db)
        return { data: flag }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    reviewFlag: builder.mutation<FeatureFlag, { id: string; payload: ReviewPayload }>({
      async queryFn({ id, payload }) {
        await delay(260)
        try {
          return { data: applyReview(id, payload) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '审批失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    rollbackFlag: builder.mutation<FeatureFlag, { id: string; actor: string; reason: string }>({
      async queryFn({ id, actor, reason }) {
        await delay(260)
        try {
          return { data: rollbackFlag(id, actor, reason) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '回滚失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    getIssues: builder.query<ImpactIssue[], { category?: string; resolved?: boolean }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().issues.filter(
          (issue) =>
            (!filters.category || issue.category === filters.category) &&
            (filters.resolved === undefined || issue.resolved === filters.resolved),
        )
        return { data }
      },
      providesTags: ['Issues'],
    }),
    getAudit: builder.query<AuditEvent[], { flagId?: string; action?: string }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().audit.filter(
          (event) =>
            (!filters.flagId || event.flagId === filters.flagId) &&
            (!filters.action || event.action === filters.action),
        )
        return { data }
      },
      providesTags: ['Audit'],
    }),
    getReleaseOverview: builder.query<ReleaseOverview, void>({
      async queryFn() {
        await delay()
        return { data: getReleaseOverview() }
      },
      providesTags: ['ReleaseBatches'],
    }),
    refreshBatchFreshness: builder.mutation<unknown, string>({
      async queryFn(batchId) {
        try {
          refreshBatchFreshness(batchId)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '候选校验失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches'],
    }),
    createReleaseBatch: builder.mutation<
      ReturnType<typeof createReleaseBatch>,
      { flagId: string; targets: Environment[]; actor: string }
    >({
      async queryFn(input) {
        await delay(260)
        try {
          return { data: createReleaseBatch(input) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '创建批次失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Audit'],
    }),
    regenerateBatchCandidates: builder.mutation<unknown, { batchId: string; actor: string }>({
      async queryFn({ batchId, actor }) {
        await delay(220)
        try {
          regenerateBatchCandidates(batchId, actor)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '重新生成失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Audit'],
    }),
    confirmReleaseBatch: builder.mutation<unknown, { batchId: string; actor: string }>({
      async queryFn({ batchId, actor }) {
        await delay(260)
        try {
          confirmReleaseBatch(batchId, actor)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '确认批次失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Audit'],
    }),
    applyReleaseBatch: builder.mutation<unknown, { batchId: string; actor: string }>({
      async queryFn({ batchId, actor }) {
        await delay(320)
        try {
          applyReleaseBatch(batchId, actor)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '执行批次失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Flags', 'Flag', 'Dashboard', 'Audit'],
    }),
    retryReleaseBatch: builder.mutation<unknown, { batchId: string; actor: string }>({
      async queryFn({ batchId, actor }) {
        await delay(320)
        try {
          retryReleaseBatch(batchId, actor)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '批次重试失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Flags', 'Flag', 'Dashboard', 'Audit'],
    }),
    rollbackReleaseBatch: builder.mutation<
      unknown,
      { batchId: string; actor: string; reason: string }
    >({
      async queryFn({ batchId, actor, reason }) {
        await delay(320)
        try {
          rollbackReleaseBatch(batchId, actor, reason)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '整批回滚失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Flags', 'Flag', 'Dashboard', 'Audit'],
    }),
    simulateSourceDrift: builder.mutation<unknown, { flagId: string; actor: string }>({
      async queryFn({ flagId, actor }) {
        await delay(200)
        try {
          simulateSourceDrift(flagId, actor)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '模拟来源变化失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Flags', 'Flag', 'Audit'],
    }),
    saveEnvBaseline: builder.mutation<unknown, { environment: Environment; version: string }>({
      async queryFn({ environment, version }) {
        await delay(180)
        try {
          saveEnvBaseline(environment, version)
          return { data: null }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '基线更新失败' } }
        }
      },
      invalidatesTags: ['ReleaseBatches', 'Audit'],
    }),
    armWriteFailure: builder.mutation<unknown, void>({
      async queryFn() {
        armNextWriteFailure()
        return { data: null }
      },
      invalidatesTags: ['ReleaseBatches'],
    }),
  }),
})

export const {
  useGetDashboardQuery,
  useGetFlagsQuery,
  useGetFlagQuery,
  useSaveFlagMutation,
  useSubmitForReviewMutation,
  useReviewFlagMutation,
  useRollbackFlagMutation,
  useGetIssuesQuery,
  useGetAuditQuery,
  useGetReleaseOverviewQuery,
  useRefreshBatchFreshnessMutation,
  useCreateReleaseBatchMutation,
  useRegenerateBatchCandidatesMutation,
  useConfirmReleaseBatchMutation,
  useApplyReleaseBatchMutation,
  useRetryReleaseBatchMutation,
  useRollbackReleaseBatchMutation,
  useSimulateSourceDriftMutation,
  useSaveEnvBaselineMutation,
  useArmWriteFailureMutation,
} = flagApi
