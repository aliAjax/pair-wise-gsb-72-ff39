import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddCircleOutlineOutlinedIcon from '@mui/icons-material/AddCircleOutlineOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined'
import {
  useApplyReleaseBatchMutation,
  useArmWriteFailureMutation,
  useConfirmReleaseBatchMutation,
  useCreateReleaseBatchMutation,
  useGetReleaseOverviewQuery,
  useRefreshBatchFreshnessMutation,
  useRegenerateBatchCandidatesMutation,
  useRetryReleaseBatchMutation,
  useRollbackReleaseBatchMutation,
  useSaveEnvBaselineMutation,
  useSimulateSourceDriftMutation,
} from '@/services/flagApi'
import { environmentLabel, ENV_ORDER } from '@/services/releaseBatchUtils'
import type {
  BatchCandidateStatus,
  BatchStatus,
  Environment,
  FeatureFlag,
  ReleaseBatch,
} from '@/types'

const ACTOR = '林默'

const batchStatusLabel: Record<BatchStatus, { text: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }> = {
  draft: { text: '待确认', color: 'default' },
  confirmed: { text: '已确认待发布', color: 'info' },
  applied: { text: '已全部发布', color: 'success' },
  halted: { text: '整批停止', color: 'error' },
  'rolled-back': { text: '已整批回滚', color: 'warning' },
  superseded: { text: '重复提交已合并', color: 'default' },
}

const candidateStatusLabel: Record<BatchCandidateStatus, { text: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }> = {
  pending: { text: '待发布', color: 'info' },
  applied: { text: '已发布', color: 'success' },
  failed: { text: '写入失败', color: 'error' },
  invalidated: { text: '候选失效', color: 'warning' },
  skipped: { text: '已跳过', color: 'default' },
  'rolled-back': { text: '已回滚', color: 'warning' },
}

const gateLabel: Record<string, string> = {
  'stale-source': '来源已变化',
  'environment-order': '环境顺序冲突',
  'dependency-rolled-back': '依赖已回滚',
  'dependency-disabled': '依赖未启用',
  'dependency-missing': '依赖缺失',
  'version-unsatisfied': '最低版本不满足',
}

const formatTime = (value?: string): string =>
  value ? value.slice(0, 16).replace('T', ' ') : '—'

const errorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return fallback
}

const downstreamEnvironments = (environment: Environment): Environment[] =>
  ENV_ORDER.slice(ENV_ORDER.indexOf(environment) + 1)

export function ReleaseBatchesPage() {
  const { data, isLoading } = useGetReleaseOverviewQuery(undefined, { refetchOnMountOrArgChange: true })
  const [createBatch, createState] = useCreateReleaseBatchMutation()
  const [refreshFreshness, refreshState] = useRefreshBatchFreshnessMutation()
  const [regenerateCandidates] = useRegenerateBatchCandidatesMutation()
  const [confirmBatch, confirmState] = useConfirmReleaseBatchMutation()
  const [applyBatch, applyState] = useApplyReleaseBatchMutation()
  const [retryBatch, retryState] = useRetryReleaseBatchMutation()
  const [rollbackBatch, rollbackState] = useRollbackReleaseBatchMutation()
  const [simulateDrift] = useSimulateSourceDriftMutation()
  const [saveBaseline] = useSaveEnvBaselineMutation()
  const [armWriteFailure, armState] = useArmWriteFailureMutation()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedFlagId, setSelectedFlagId] = useState('')
  const [targets, setTargets] = useState<Environment[]>([])
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseBatch | null>(null)
  const [rollbackReason, setRollbackReason] = useState('')
  const [baselineDrafts, setBaselineDrafts] = useState<Partial<Record<Environment, string>>>({})
  const [message, setMessage] = useState('')

  // 每次进入页面都按当前来源重新校验未完成候选（确认前变化即失效）。
  useEffect(() => {
    if (!data) return
    const openBatches = data.batches.filter((batch) =>
      ['draft', 'confirmed', 'halted'].includes(batch.status),
    )
    void Promise.all(openBatches.map((batch) => refreshFreshness(batch.id).unwrap().catch(() => null)))
    // 仅在批次标识变化时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.batches.map((batch) => batch.id).join('|')])

  const sourceFlags = data?.sourceFlags ?? []
  const selectedFlag = sourceFlags.find((flag) => flag.id === selectedFlagId)

  const openCreateDialog = () => {
    setSelectedFlagId(sourceFlags[0]?.id ?? '')
    setTargets([])
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!selectedFlag || targets.length === 0) {
      setMessage('请选择来源开关和至少一个目标环境')
      return
    }
    try {
      const result = await createBatch({ flagId: selectedFlag.id, targets, actor: ACTOR }).unwrap()
      setCreateOpen(false)
      setMessage(
        result.superseded
          ? `检测到第二个提交窗口：同一开关已有进行中的批次 ${result.batch.id}，仅保留既有批次`
          : `已生成发布批次 ${result.batch.id}，候选快照不可变，请确认后发布`,
      )
    } catch (error) {
      setMessage(errorMessage(error, '创建批次失败'))
    }
  }

  const submitConfirm = async (batchId: string) => {
    try {
      await confirmBatch({ batchId, actor: ACTOR }).unwrap()
      setMessage('批次已确认，候选锁定为不可变快照，可以执行发布')
    } catch (error) {
      setMessage(errorMessage(error, '确认批次失败'))
    }
  }

  const submitApply = async (batchId: string) => {
    try {
      await applyBatch({ batchId, actor: ACTOR }).unwrap()
      setMessage('批次执行完成，全部候选已按环境顺序写入')
    } catch (error) {
      setMessage(errorMessage(error, '执行批次失败'))
    }
  }

  const submitRetry = async (batchId: string) => {
    try {
      await retryBatch({ batchId, actor: ACTOR }).unwrap()
      setMessage('已从保留的未完成项重试，已发布环境保持候选值')
    } catch (error) {
      setMessage(errorMessage(error, '批次重试失败'))
    }
  }

  const submitRollback = async () => {
    if (!rollbackTarget || rollbackReason.trim().length < 8) {
      setMessage('回滚原因至少 8 个字符')
      return
    }
    try {
      await rollbackBatch({ batchId: rollbackTarget.id, actor: ACTOR, reason: rollbackReason }).unwrap()
      setMessage('整批回滚完成：仅恢复候选中的受众、依赖与灰度阶段，审计仍可查询')
      setRollbackTarget(null)
      setRollbackReason('')
    } catch (error) {
      setMessage(errorMessage(error, '整批回滚失败'))
    }
  }

  const submitBaseline = async (environment: Environment) => {
    const version = baselineDrafts[environment]
    if (!version) return
    try {
      await saveBaseline({ environment, version }).unwrap()
      setBaselineDrafts((current) => ({ ...current, [environment]: undefined }))
      setMessage(`${environmentLabel[environment]}环境在线客户端基线已更新为 ${version}`)
    } catch (error) {
      setMessage(errorMessage(error, '基线更新失败'))
    }
  }

  const recheckBatches = async (ids?: string[]) => {
    const targetIds =
      ids ??
      (data?.batches ?? [])
        .filter((batch) => ['draft', 'confirmed', 'halted'].includes(batch.status))
        .map((batch) => batch.id)
    await Promise.all(targetIds.map((id) => refreshFreshness(id).unwrap().catch(() => null)))
  }

  const busy =
    createState.isLoading ||
    confirmState.isLoading ||
    applyState.isLoading ||
    retryState.isLoading ||
    rollbackState.isLoading ||
    refreshState.isLoading

  const summary = useMemo(() => {
    const batches = data?.batches ?? []
    return {
      total: batches.filter((batch) => batch.status !== 'superseded').length,
      open: batches.filter((batch) => ['draft', 'confirmed'].includes(batch.status)).length,
      halted: batches.filter((batch) => batch.status === 'halted').length,
      applied: batches.filter((batch) => batch.status === 'applied').length,
    }
  }, [data])

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">多环境发布批次</Typography>
          <Typography color="text.secondary">
            把同一开关跨环境发布收成一个批次：候选固化受众、依赖开关、最低客户端版本和灰度阶段，
            来源变化即失效，按开发 → 预发 → 生产顺序逐环境放行。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} loading={refreshState.isLoading}
            onClick={() => void recheckBatches().then(() => setMessage('已按当前来源重新校验所有进行中批次的候选'))}>
            重新校验候选
          </Button>
          <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateDialog}>
            新建发布批次
          </Button>
        </Stack>
      </Box>

      {message && (
        <Alert
          severity={message.includes('失败') || message.includes('停止') || message.includes('请') ? 'error' : 'success'}
          onClose={() => setMessage('')}
          sx={{ mb: 2 }}
        >
          {message}
        </Alert>
      )}
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box className="batch-toolbar">
            <Stack direction="row" spacing={1.2}>
              <Chip size="small" variant="outlined" label={`批次 ${summary.total}`} />
              <Chip size="small" color="info" variant="outlined" label={`待确认/待发布 ${summary.open}`} />
              <Chip size="small" color="error" variant="outlined" label={`整批停止 ${summary.halted}`} />
              <Chip size="small" color="success" variant="outlined" label={`已完成 ${summary.applied}`} />
            </Stack>
            <Box className="baseline-editor">
              <Typography variant="caption" color="text.secondary">
                在线客户端覆盖基线（版本门禁）
              </Typography>
              {ENV_ORDER.map((environment) => {
                const saved = data?.baselines[environment] ?? '0.0.0'
                const draft = baselineDrafts[environment] ?? saved
                return (
                  <Stack key={environment} direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="caption" fontWeight={700}>
                      {environmentLabel[environment]}
                    </Typography>
                    <TextField
                      size="small"
                      sx={{ width: 110 }}
                      value={draft}
                      onChange={(event) =>
                        setBaselineDrafts((current) => ({ ...current, [environment]: event.target.value }))
                      }
                    />
                    <Button size="small" onClick={() => void submitBaseline(environment)} disabled={draft === saved}>
                      保存
                    </Button>
                  </Stack>
                )
              })}
              <Button
                size="small"
                color={data?.writeFailureArmed ? 'error' : 'inherit'}
                startIcon={<BugReportOutlinedIcon />}
                onClick={() => {
                  void armWriteFailure().unwrap()
                  setMessage('已注入下一次写入失败：执行批次时当前环境会写入失败，未完成项保留后可重试')
                }}
                disabled={armState.isLoading || Boolean(data?.writeFailureArmed)}
              >
                {data?.writeFailureArmed ? '写入失败已注入' : '模拟下一次写入失败'}
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {(data?.batches ?? []).map((batch) => {
        const statusMeta = batchStatusLabel[batch.status]
        const invalidatedCount = batch.candidates.filter((candidate) => candidate.status === 'invalidated').length
        const stalePendingCount = batch.candidates.filter(
          (candidate) => candidate.status === 'pending' && candidate.gate?.code === 'stale-source',
        ).length
        const blockingCount = batch.candidates.filter((candidate) => candidate.gate && (candidate.status === 'pending' || candidate.status === 'failed')).length
        return (
          <Card key={batch.id} className="batch-card">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="h3">{batch.flagName}</Typography>
                    <Chip size="small" label={statusMeta.text} color={statusMeta.color} variant={batch.status === 'applied' ? 'filled' : 'outlined'} />
                    <Typography variant="caption" color="text.secondary">{batch.id} · {batch.flagKey}</Typography>
                  </Stack>
                  <Box className="batch-meta">
                    <Typography variant="caption" color="text.secondary">创建人 {batch.createdBy} · {formatTime(batch.createdAt)}</Typography>
                    <Typography variant="caption" color="text.secondary">确认 {batch.confirmedBy ?? '—'} · {formatTime(batch.confirmedAt)}</Typography>
                    {batch.haltedAt && <Typography variant="caption" color="error.main">停止于 {formatTime(batch.haltedAt)}</Typography>}
                    {batch.rollbackAt && <Typography variant="caption" color="warning.main">回滚于 {formatTime(batch.rollbackAt)} · {batch.rollbackBy}</Typography>}
                  </Box>
                  {batch.note && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{batch.note}</Typography>}
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent="flex-end">
                  {batch.status === 'draft' && (
                    <>
                      <Button size="small" startIcon={<ReplayOutlinedIcon />} disabled={invalidatedCount === 0 || busy}
                        onClick={() => void regenerateCandidates({ batchId: batch.id, actor: ACTOR }).unwrap().then(() => setMessage('失效候选已按最新来源重新生成')).catch(() => setMessage('重新生成失败，请重试'))}>
                        重新生成失效候选
                      </Button>
                      <Button size="small" variant="contained" color="primary" startIcon={<LockOutlinedIcon />} disabled={busy || invalidatedCount > 0 || stalePendingCount > 0}
                        onClick={() => void submitConfirm(batch.id)}>
                        确认候选
                      </Button>
                    </>
                  )}
                  {batch.status === 'confirmed' && (
                    <Button size="small" variant="contained" startIcon={<PlayArrowOutlinedIcon />} disabled={busy || stalePendingCount > 0}
                      onClick={() => void submitApply(batch.id)}>
                      执行发布
                    </Button>
                  )}
                  {batch.status === 'halted' && (
                    <>
                      <Button size="small" variant="contained" color="primary" startIcon={<ReplayOutlinedIcon />} disabled={busy}
                        onClick={() => void submitRetry(batch.id)}>
                        从断点重试
                      </Button>
                      <Button size="small" color="error" variant="outlined" startIcon={<UndoOutlinedIcon />} disabled={busy}
                        onClick={() => { setRollbackTarget(batch); setRollbackReason('') }}>
                        整批回滚
                      </Button>
                    </>
                  )}
                  {batch.status === 'applied' && (
                    <Button size="small" color="warning" variant="outlined" startIcon={<UndoOutlinedIcon />} disabled={busy}
                      onClick={() => { setRollbackTarget(batch); setRollbackReason('') }}>
                      整批回滚
                    </Button>
                  )}
                </Stack>
              </Stack>

              {invalidatedCount > 0 && batch.status === 'draft' && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  有 {invalidatedCount} 个候选因来源环境的受众、依赖、最低客户端版本或灰度阶段变化而失效，
                  重新生成后才能确认批次。
                </Alert>
              )}
              {stalePendingCount > 0 && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  有 {stalePendingCount} 个待发布候选的来源在批次确认后发生变化（受众、依赖、最低客户端版本或灰度阶段），执行时会立即整批停止，请重新校验或新建批次。
                </Alert>
              )}
              {batch.status === 'halted' && (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  整批已停止：已写入环境保持候选值，后续环境未发布。{blockingCount > 0 ? '排除门禁后可从保留的未完成项重试。' : ''}
                </Alert>
              )}
              {batch.status === 'rolled-back' && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  整批回滚仅恢复候选恢复点中的受众、依赖开关与灰度阶段；最低客户端版本、开关状态等发布后字段保持不变，全部发布与审批审计仍可在审计页查询。
                </Alert>
              )}

              <Box className="batch-candidate-list">
                {batch.candidates.map((candidate) => {
                  const candidateMeta = candidateStatusLabel[candidate.status]
                  return (
                    <Box key={candidate.id} className={`batch-candidate ${candidate.status}`}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                        <Stack direction="row" spacing={1.2} alignItems="center" flexWrap="wrap" useFlexGap>
                          <span className="candidate-route">
                            {environmentLabel[candidate.sourceEnvironment]} → {environmentLabel[candidate.targetEnvironment]}
                          </span>
                          <Chip size="small" label={candidateMeta.text} color={candidateMeta.color} variant={candidate.status === 'applied' ? 'filled' : 'outlined'} />
                          {candidate.gate && (candidate.status === 'pending' || candidate.status === 'failed' || candidate.status === 'invalidated') && (
                            <Chip size="small" color="error" label={`门禁：${gateLabel[candidate.gate.code] ?? candidate.gate.code}`} />
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          写入 {formatTime(candidate.appliedAt)}
                        </Typography>
                      </Stack>

                      <Box className="snapshot-grid">
                        <div>
                          <Typography variant="caption">受众规则（不可变）</Typography>
                          <Typography variant="body2" fontWeight={700}>{candidate.snapshot.audienceRules.length} 条</Typography>
                        </div>
                        <div>
                          <Typography variant="caption">依赖开关（不可变）</Typography>
                          <Typography variant="body2" fontWeight={700}>{candidate.snapshot.dependencies.length} 项</Typography>
                        </div>
                        <div>
                          <Typography variant="caption">最低客户端版本</Typography>
                          <Typography variant="body2" fontWeight={700}>{candidate.snapshot.minClientVersion}</Typography>
                        </div>
                        <div>
                          <Typography variant="caption">灰度阶段 / 比例</Typography>
                          <Typography variant="body2" fontWeight={700}>{candidate.snapshot.rolloutSteps.length} 个 · {candidate.snapshot.rolloutPercentage}%</Typography>
                        </div>
                      </Box>

                      {candidate.gate && (candidate.status === 'pending' || candidate.status === 'failed' || candidate.status === 'invalidated') && (
                        <Alert severity={candidate.status === 'failed' ? 'error' : 'warning'} sx={{ mt: 1.2 }}>
                          {candidate.status === 'failed'
                            ? candidate.blockingDetail ?? '上一次写入失败，未完成项已保留，可直接重试。'
                            : candidate.gate.detail}
                        </Alert>
                      )}
                      {candidate.status === 'rolled-back' && candidate.restorePoint && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                          已恢复候选恢复点：受众 {candidate.restorePoint.audienceRules.length} 条、
                          依赖 {candidate.restorePoint.dependencies.length} 项、阶段 {candidate.restorePoint.rolloutSteps.length} 个
                          {candidate.restorePoint.targetExisted ? '' : '（发布时新建的目标记录已移除）'}。
                        </Typography>
                      )}
                    </Box>
                  )
                })}
              </Box>

              {batch.status === 'draft' && batch.candidates.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  <Button
                    size="small"
                    color="warning"
                    disabled={!batch.candidates[0]?.sourceFlagId}
                    onClick={() => {
                      const sourceFlagId = batch.candidates[0]?.sourceFlagId
                      if (!sourceFlagId) return
                      void simulateDrift({ flagId: sourceFlagId, actor: '陈思远' })
                        .unwrap()
                        .then(() => recheckBatches([batch.id]))
                        .then(() => setMessage('已模拟来源环境调整最低客户端版本，候选已判定为失效'))
                        .catch(() => setMessage('模拟来源变化失败'))
                    }}
                  >
                    模拟来源环境调整最低客户端版本（候选应失效）
                  </Button>
                </Stack>
              )}
            </CardContent>
          </Card>
        )
      })}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建多环境发布批次</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            批次会从选中环境生成不可变候选：保留受众、依赖开关、最低客户端版本和灰度阶段。
            两个窗口同时为同一开关提交时，只保留一个进行中的批次。
          </Alert>
          <TextField
            select
            label="来源环境开关"
            fullWidth
            value={selectedFlagId}
            onChange={(event) => {
              setSelectedFlagId(event.target.value)
              setTargets([])
            }}
          >
            {sourceFlags.map((flag: FeatureFlag) => (
              <MenuItem key={flag.id} value={flag.id}>
                {flag.name} · {flag.key} · {environmentLabel[flag.environment]}（{flag.rolloutPercentage}%）
              </MenuItem>
            ))}
          </TextField>
          {selectedFlag && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                目标环境（按环境顺序发布）
              </Typography>
              <Stack sx={{ mt: 0.5 }}>
                {downstreamEnvironments(selectedFlag.environment).map((environment) => (
                  <FormControlLabel
                    key={environment}
                    control={
                      <Checkbox
                        checked={targets.includes(environment)}
                        onChange={(event) =>
                          setTargets((current) =>
                            event.target.checked ? [...current, environment] : current.filter((item) => item !== environment),
                          )
                        }
                      />
                    }
                    label={`${environmentLabel[environment]}（${environment}）`}
                  />
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                候选将固化当前最低客户端 {selectedFlag.minClientVersion[selectedFlag.environment]}、
                受众 {selectedFlag.audienceRules.length} 条、依赖 {selectedFlag.dependencies.length} 项、
                灰度阶段 {selectedFlag.rolloutSteps.length} 个。
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="contained" loading={createState.isLoading} onClick={() => void submitCreate()}>
            生成不可变候选
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(rollbackTarget)} onClose={() => setRollbackTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>整批回滚 {rollbackTarget?.flagName}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            整批回滚只恢复每个候选恢复点中的受众规则、依赖开关和灰度阶段；最低客户端版本、开关状态等字段保持发布后的值。
            原有审批、发布和回滚审计全部保留，仍可在审计页查询。
          </Alert>
          <TextField
            label="回滚原因与异常证据"
            multiline
            minRows={3}
            fullWidth
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackTarget(null)}>取消</Button>
          <Button color="warning" variant="contained" loading={rollbackState.isLoading} onClick={() => void submitRollback()}>
            执行整批回滚
          </Button>
        </DialogActions>
      </Dialog>

      <Divider sx={{ mt: 1, mb: 2 }} />
      <Typography variant="caption" color="text.secondary">
        门禁说明：依赖在目标环境被回滚/未启用、候选最低版本高于在线基线、或跨环境顺序缺少上游放量记录时，整批立即停止；
        写入失败只保留未完成项，修复后从断点重试，已发布环境不会重复写入。
      </Typography>
    </Box>
  )
}
