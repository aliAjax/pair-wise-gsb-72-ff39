import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  Typography,
} from '@mui/material'
import AddCardOutlinedIcon from '@mui/icons-material/AddCardOutlined'
import AutorenewOutlinedIcon from '@mui/icons-material/AutorenewOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import {
  useApplyBatchMutation,
  useConfirmBatchMutation,
  useCreateBatchMutation,
  useGetBatchesQuery,
  useGetFlagsQuery,
  useLazyRunBatchPreflightQuery,
  useMutateBatchDemoMutation,
  useRegenerateCandidateMutation,
  useRollbackBatchMutation,
} from '@/services/flagApi'
import { environmentLabel } from '@/services/releaseBatchService'
import type {
  BatchStatus,
  CandidateStatus,
  Environment,
  PreflightFinding,
  ReleaseBatch,
  ReleaseCandidate,
} from '@/types'

const SOURCE_ENVIRONMENTS: Environment[] = ['dev', 'staging']
const ALL_ENVIRONMENTS: Environment[] = ['dev', 'staging', 'production']

const batchStatusMeta: Record<BatchStatus, { label: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }> = {
  prepared: { label: '待确认', color: 'warning' },
  confirmed: { label: '已确认', color: 'info' },
  running: { label: '发布中', color: 'info' },
  applied: { label: '已完成', color: 'success' },
  halted: { label: '已停止', color: 'error' },
  'rolled-back': { label: '已回滚', color: 'default' },
}

const candidateStatusMeta: Record<CandidateStatus, { label: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }> = {
  prepared: { label: '待确认', color: 'warning' },
  stale: { label: '已失效', color: 'error' },
  confirmed: { label: '已锁定', color: 'info' },
  applied: { label: '已写入', color: 'success' },
  failed: { label: '写入失败', color: 'error' },
  skipped: { label: '未执行', color: 'warning' },
  'rolled-back': { label: '已回滚', color: 'default' },
}

const findingText: Record<PreflightFinding['code'], string> = {
  'dependency-rolled-back': '依赖已回滚',
  'dependency-version': '依赖版本不满足',
  'conflict-active': '互斥开关启用中',
  'version-regression': '最低版本倒退',
  'environment-order': '环境顺序冲突',
}

export function ReleaseBatchesPage() {
  const { data: flags = [], isLoading: flagsLoading } = useGetFlagsQuery({})
  const { data: batches = [], isFetching: batchesLoading } = useGetBatchesQuery()
  const [createBatch, createState] = useCreateBatchMutation()
  const [regenerateCandidate, regenerateState] = useRegenerateCandidateMutation()
  const [confirmBatch, confirmState] = useConfirmBatchMutation()
  const [applyBatch, applyState] = useApplyBatchMutation()
  const [rollbackBatch, rollbackState] = useRollbackBatchMutation()
  const [mutateDemo] = useMutateBatchDemoMutation()
  const [triggerPreflight, preflightState] = useLazyRunBatchPreflightQuery()

  const [flagId, setFlagId] = useState('flag-101')
  const [sources, setSources] = useState<Environment[]>(['staging'])
  const [message, setMessage] = useState<{ text: string; severity: 'success' | 'info' | 'error' } | null>(null)
  const [preflightByBatch, setPreflightByBatch] = useState<Record<string, PreflightFinding[]>>({})
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseBatch | null>(null)
  const [rollbackReason, setRollbackReason] = useState('')

  const selectedFlag = flags.find((flag) => flag.id === flagId)
  const flagOf = (id: string) => flags.find((flag) => flag.id === id)

  const orderedSources = useMemo(() => {
    const envOrder: Environment[] = ['dev', 'staging']
    return envOrder.filter((environment) => sources.includes(environment))
  }, [sources])

  const toggleSource = (environment: Environment) => {
    setSources((current) => {
      if (current.includes(environment)) return current.filter((item) => item !== environment)
      // 保持连续：选择 dev 时若已有 staging 则组成 dev→staging，否则单选。
      return [...current, environment].sort(
        (a, b) => ALL_ENVIRONMENTS.indexOf(a) - ALL_ENVIRONMENTS.indexOf(b),
      )
    })
  }

  const notify = (text: string, severity: 'success' | 'info' | 'error' = 'success') =>
    setMessage({ text, severity })

  const submitCreate = async () => {
    if (orderedSources.length === 0) {
      notify('请至少选择一个来源环境', 'error')
      return
    }
    try {
      const result = await createBatch({
        flagId,
        sources: orderedSources,
        createdBy: '林默',
      }).unwrap()
      notify(
        result.deduplicated
          ? '两个窗口提交了同一发布：只保留先创建的批次，本次自动复用'
          : '已从选中环境生成不可变候选，确认前来源变化会令候选失效',
        result.deduplicated ? 'info' : 'success',
      )
    } catch (error) {
      notify(error instanceof Error && 'message' in error ? String((error as { message: unknown }).message) : '生成批次失败', 'error')
    }
  }

  const runPreflightFor = async (batch: ReleaseBatch) => {
    try {
      const findings = await triggerPreflight(batch.id, true).unwrap()
      setPreflightByBatch((current) => ({ ...current, [batch.id]: findings }))
      const blockers = findings.filter((finding) => finding.severity === 'blocker').length
      notify(
        blockers > 0 ? `预检发现 ${blockers} 个阻断项，发布将整批停止` : '预检通过，未发现阻断项',
        blockers > 0 ? 'error' : 'success',
      )
    } catch {
      notify('预检执行失败', 'error')
    }
  }

  const handleConfirm = async (batch: ReleaseBatch) => {
    try {
      await confirmBatch({ batchId: batch.id, actor: '林默' }).unwrap()
      notify('批次已确认，候选的受众、依赖、最低版本与灰度阶段已锁定')
    } catch (error) {
      notify(String((error as { message: unknown }).message), 'error')
    }
  }

  const handleApply = async (batch: ReleaseBatch) => {
    try {
      const result = await applyBatch({ batchId: batch.id, actor: '林默' }).unwrap()
      setPreflightByBatch((current) => ({ ...current, [batch.id]: result.findings }))
      if (result.batch.status === 'halted') {
        notify(`整批停止：${result.batch.haltReason ?? '存在未完成候选，可从保留项重试'}`, 'error')
      } else {
        notify('批次全部环境已按 dev → staging → production 顺序写入完成')
      }
    } catch (error) {
      notify(String((error as { message: unknown }).message), 'error')
    }
  }

  const submitRollback = async () => {
    if (!rollbackTarget) return
    try {
      await rollbackBatch({ batchId: rollbackTarget.id, actor: '林默', reason: rollbackReason }).unwrap()
      setRollbackTarget(null)
      setRollbackReason('')
      notify('已整批回滚：各环境只恢复发布前锚点中的受众、依赖和灰度阶段，历史审计仍可查')
    } catch (error) {
      notify(String((error as { message: unknown }).message), 'error')
    }
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">多环境发布批次</Typography>
          <Typography color="text.secondary">
            把同一开关的多环境发布收成一个批次：从来源冻结不可变候选，确认前来源变化即失效，发布按环境顺序整体推进、整体回滚。
          </Typography>
        </Box>
        <Chip label={`${batches.length} 个批次`} color="primary" variant="outlined" />
      </Box>

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}
      {(flagsLoading || batchesLoading) && <LinearProgress sx={{ mb: 2 }} />}

      {/* 生成批次 */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <AddCardOutlinedIcon color="primary" fontSize="small" />
            <Typography variant="h3">生成发布批次</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            选择开关与来源环境，系统从来源当前配置生成不可变候选（受众、依赖开关、最低客户端版本、灰度阶段）。生产不能作为来源。
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mt: 2 }}>
            <TextField
              select
              label="功能开关"
              value={flagId}
              onChange={(event) => setFlagId(event.target.value)}
              sx={{ minWidth: 300 }}
            >
              {flags.map((flag) => (
                <MenuItem key={flag.id} value={flag.id}>
                  {flag.name} · {flag.key}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                来源环境（按发布顺序连续推进）
              </Typography>
              <Stack direction="row" spacing={1} className="source-toggle">
                {SOURCE_ENVIRONMENTS.map((environment) => (
                  <ToggleButton
                    key={environment}
                    value={environment}
                    selected={sources.includes(environment)}
                    onClick={() => toggleSource(environment)}
                    size="small"
                  >
                    {environmentLabel[environment]}
                  </ToggleButton>
                ))}
              </Stack>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddCardOutlinedIcon />}
              loading={createState.isLoading}
              onClick={() => void submitCreate()}
              sx={{ ml: 'auto' }}
            >
              生成不可变候选
            </Button>
          </Stack>
          {selectedFlag && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
              {orderedSources.map((source) => {
                const target = source === 'dev' ? 'staging' : 'production'
                return (
                  <Chip
                    key={source}
                    size="small"
                    variant="outlined"
                    label={`${environmentLabel[source]} → ${environmentLabel[target as Environment]}`}
                  />
                )
              })}
              <Chip size="small" variant="outlined" label={`将冻结受众 ${selectedFlag.audienceRules.length} 条`} />
              <Chip size="small" variant="outlined" label={`依赖 ${selectedFlag.dependencies.length} 项`} />
              <Chip size="small" variant="outlined" label={`灰度阶段 ${selectedFlag.rolloutSteps.length} 个`} />
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* 场景模拟：让核心保证可直接体验 */}
      <Card sx={{ mb: 2 }} variant="outlined">
        <CardContent>
          <Typography variant="h3" sx={{ mb: 0.5 }}>场景演练（作用于上面选中的开关）</Typography>
          <Typography variant="caption" color="text.secondary">
            模拟来源在确认前换依赖/版本、依赖被回滚、生产抬高最低版本、写入失败等情况，观察候选失效、整批停止、保留重试与受限回滚。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              disabled={!selectedFlag}
              onClick={() =>
                mutateDemo({ kind: 'source', flagId, environment: 'staging', actor: '陈思远' })
                  .unwrap()
                  .then(() => notify('STAGING 来源已变更，未确认候选将被标记为失效', 'info'))
              }
            >
              改动 STAGING 来源（候选失效）
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={!selectedFlag || flagId !== 'flag-101'}
              onClick={() =>
                mutateDemo({ kind: 'dependency', dependencyFlagId: 'flag-104', environment: 'production', actor: '韩秋' })
                  .unwrap()
                  .then(() => notify('支付聚合路由已在生产回滚，预检将阻断依赖它的候选', 'info'))
              }
            >
              回滚前置依赖（生产）
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={!selectedFlag}
              onClick={() =>
                mutateDemo({ kind: 'target-version', flagId, environment: 'production', actor: '林默' })
                  .unwrap()
                  .then(() => notify('生产最低客户端版本已上调，旧候选将不满足版本要求', 'info'))
              }
            >
              抬高生产最低客户端版本
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                void mutateDemo({ kind: 'fail-write', environment: 'production' }).unwrap()
                notify('已预置：下一次向生产的写入将失败，可从保留的未完成项重试', 'info')
              }}
            >
              预置生产写入失败
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* 批次列表 */}
      {batches.map((batch) => {
        const flag = flagOf(batch.flagId)
        const findings = preflightByBatch[batch.id] ?? []
        const blockers = findings.filter((finding) => finding.severity === 'blocker')
        const hasStale = batch.candidates.some((candidate) => candidate.status === 'stale')
        const hasUnfinished = batch.candidates.some(
          (candidate) => candidate.status === 'failed' || candidate.status === 'skipped',
        )
        const hasApplied = batch.candidates.some((candidate) => candidate.status === 'applied')
        const meta = batchStatusMeta[batch.status]
        return (
          <Card key={batch.id} sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 1.5 }}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h3">{flag?.name ?? batch.flagKey}</Typography>
                    <Chip size="small" color={meta.color} label={meta.label} />
                    {hasStale && <Chip size="small" color="warning" label="含失效候选" />}
                    {hasUnfinished && <Chip size="small" color="error" label="含未完成项" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {batch.id} · {batch.flagKey} · 发起人 {batch.createdBy} · {batch.createdAt.slice(0, 16).replace('T', ' ')}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    startIcon={<RefreshOutlinedIcon />}
                    loading={preflightState.isLoading}
                    disabled={!['confirmed', 'halted'].includes(batch.status)}
                    onClick={() => void runPreflightFor(batch)}
                  >
                    运行预检
                  </Button>
                  {batch.status === 'prepared' && (
                    <Button
                      size="small"
                      variant="contained"
                      color="info"
                      startIcon={<LockOutlinedIcon />}
                      disabled={hasStale || confirmState.isLoading}
                      onClick={() => void handleConfirm(batch)}
                    >
                      确认批次
                    </Button>
                  )}
                  {(batch.status === 'confirmed' || batch.status === 'halted') && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<PlayArrowOutlinedIcon />}
                      loading={applyState.isLoading}
                      onClick={() => void handleApply(batch)}
                    >
                      {batch.status === 'halted' ? '从保留项重试发布' : '执行发布'}
                    </Button>
                  )}
                  {hasApplied && batch.status !== 'rolled-back' && (
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<UndoOutlinedIcon />}
                      onClick={() => {
                        setRollbackTarget(batch)
                        setRollbackReason('生产指标异常，按批次回滚候选内受众、依赖与灰度阶段。')
                      }}
                    >
                      整批回滚
                    </Button>
                  )}
                </Stack>
              </Stack>

              {batch.haltReason && (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                  整批停止原因：{batch.haltReason}
                  {hasUnfinished && ' 未完成候选已保留，修复后可直接“从保留项重试发布”。'}
                </Alert>
              )}
              {batch.status === 'rolled-back' && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  已整批回滚：只把各环境的受众、依赖和灰度阶段恢复到发布前锚点，最低客户端版本与其它字段保持现状，全部历史审计仍可在“审计与回滚”中查询。
                </Alert>
              )}

              <Box className="batch-candidate-grid">
                {batch.candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    canRegenerate={batch.status === 'prepared'}
                    regenerating={regenerateState.isLoading}
                    findings={findings.filter((finding) => finding.candidateId === candidate.id)}
                    onRegenerate={() =>
                      regenerateCandidate({ batchId: batch.id, candidateId: candidate.id, actor: '林默' })
                        .unwrap()
                        .then(() => notify('已从当前来源重新冻结候选，旧指纹替换为新指纹'))
                        .catch((error: unknown) =>
                          notify(String((error as { message: unknown }).message), 'error'),
                        )
                    }
                  />
                ))}
              </Box>

              {blockers.length > 0 && (
                <>
                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="h3" sx={{ mb: 1 }}>预检阻断项（整批停下）</Typography>
                  <Stack spacing={1}>
                    {blockers.map((finding) => (
                      <Box key={`${finding.candidateId}-${finding.code}`} className={`preflight-finding ${finding.severity}`}>
                        <VerifiedOutlinedIcon color="error" fontSize="small" />
                        <Box>
                          <Stack direction="row" spacing={0.7} alignItems="center">
                            <Chip size="small" color="error" label={findingText[finding.code]} />
                            <Typography variant="caption" color="text.secondary">
                              {batch.candidates.find((candidate) => candidate.id === finding.candidateId)?.targetEnvironment.toUpperCase()}
                            </Typography>
                          </Stack>
                          <Typography variant="body2" sx={{ mt: 0.5 }}>{finding.message}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                </>
              )}
              {findings.length > 0 && blockers.length === 0 && (
                <Alert severity="success" sx={{ mt: 1.5 }}>预检通过：依赖、最低版本与环境顺序均满足。</Alert>
              )}
            </CardContent>
          </Card>
        )
      })}

      {!batchesLoading && batches.length === 0 && (
        <Card>
          <CardContent className="empty-state">
            <Stack alignItems="center" spacing={1}>
              <ContentCopyOutlinedIcon color="disabled" />
              <Typography color="text.secondary">还没有发布批次，从上方选择环境生成第一批不可变候选。</Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(rollbackTarget)} onClose={() => setRollbackTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>整批回滚 {rollbackTarget && flagOf(rollbackTarget.flagId)?.name}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            回滚按目标环境倒序执行，只把每个环境的受众规则、依赖开关和灰度阶段（含灰度比例与启停）恢复到该候选写入前的锚点；
            最低客户端版本及其它字段保持现状，批次全部历史审计一条都不会删除。
          </Alert>
          <TextField
            label="回滚原因"
            multiline
            minRows={3}
            fullWidth
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackTarget(null)}>取消</Button>
          <Button color="error" variant="contained" loading={rollbackState.isLoading} onClick={() => void submitRollback()}>
            确认整批回滚
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

interface CandidateCardProps {
  candidate: ReleaseCandidate
  canRegenerate: boolean
  regenerating: boolean
  findings: PreflightFinding[]
  onRegenerate: () => void
}

function CandidateCard({ candidate, canRegenerate, regenerating, findings, onRegenerate }: CandidateCardProps) {
  const { snapshot } = candidate
  const meta = candidateStatusMeta[candidate.status]
  return (
    <Box className={`candidate-card ${candidate.status}`} sx={{ p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box className="candidate-flow">
          <Chip size="small" label={environmentLabel[candidate.sourceEnvironment]} variant="outlined" />
          <Typography variant="body2">→</Typography>
          <Chip size="small" label={environmentLabel[candidate.targetEnvironment]} color="primary" />
        </Box>
        <Chip size="small" color={meta.color} label={meta.label} />
      </Stack>

      {candidate.status === 'stale' && (
        <Alert severity="warning" sx={{ mb: 1, py: 0.25 }} icon={<AutorenewOutlinedIcon fontSize="inherit" />}>
          来源在确认前发生变化，候选已失效
        </Alert>
      )}
      {candidate.status === 'failed' && candidate.failureReason && (
        <Alert severity="error" sx={{ mb: 1, py: 0.25 }}>{candidate.failureReason}</Alert>
      )}

      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`受众 ${snapshot.audienceRules.length}`} />
        <Chip size="small" label={`依赖 ${snapshot.dependencies.length}`} />
        <Chip size="small" label={`最低版本 ${snapshot.minClientVersion}`} />
        <Chip size="small" label={`灰度 ${snapshot.rolloutPercentage}%`} />
        <Chip size="small" label={`阶段 ${snapshot.rolloutSteps.length}`} />
      </Stack>

      <Typography variant="caption" display="block" className="snapshot-hash" sx={{ mt: 1 }}>
        候选指纹 {candidate.snapshotHash}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        来源指纹 {candidate.sourceFingerprint} · 生成于 {candidate.preparedAt.slice(5, 16).replace('T', ' ')}
      </Typography>

      {findings.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {findings.map((finding) => (
            <Chip
              key={finding.code}
              size="small"
              color={finding.severity === 'blocker' ? 'error' : 'warning'}
              variant="outlined"
              label={findingText[finding.code]}
            />
          ))}
        </Stack>
      )}

      {canRegenerate && candidate.status === 'stale' && (
        <Button
          fullWidth
          size="small"
          sx={{ mt: 1 }}
          startIcon={<AutorenewOutlinedIcon />}
          loading={regenerating}
          onClick={onRegenerate}
        >
          从当前来源重新生成
        </Button>
      )}
    </Box>
  )
}

