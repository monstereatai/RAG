import {
  CloudSyncOutlined,
  CodeOutlined,
  DownloadOutlined,
  EyeOutlined,
  HistoryOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  message,
  Modal,
  Select,
  Tag,
} from 'antd';
import type { ProductionArtifactTarget } from '../service';
import type { WorkflowDetailLoadedController } from './workflow-detail-controller';
import { ARTIFACT_OPTIONS, artifactLabel } from './workflow-detail-shared';
import type {
  ProductionCodingVerification,
  ProductionQAReport,
} from './workflow-detail-shared';

const CODING_TASK_STATUS_LABELS = {
  queued: '排队中',
  running: '执行中',
  completed: '完成',
  failed: '失败',
  blocked: '阻塞',
  budget_exceeded: '预算耗尽',
  cancelled: '已取消',
  verification_failed: '验证失败',
  waiting_review: '待人工验收',
  waiting_reconciliation: '待对账',
  approved: '已批准',
  rejected: '已驳回',
} as const;

const CHECK_STATUS_LABELS = {
  passed: '通过',
  failed: '失败',
  not_applicable: '不适用',
  not_run: '未运行',
} as const;

const codingTaskTagColor = (status: string) => {
  if (status === 'completed' || status === 'passed') return 'green';
  if (status === 'approved') return 'green';
  if (status === 'running') return 'blue';
  if (status === 'queued' || status === 'waiting_review') return 'gold';
  if (status === 'rejected') return 'red';
  if (status === 'not_applicable' || status === 'not_run') return 'default';
  return 'orange';
};

export function renderWorkflowArtifacts(
  controller: WorkflowDetailLoadedController,
) {
  const {
    workflow,
    artifactTargets,
    setArtifactTargets,
    artifactVersions,
    artifactBusy,
    editTarget,
    setEditTarget,
    editBaseArtifactId,
    setEditBaseArtifactId,
    editInstruction,
    setEditInstruction,
    editDraft,
    setEditDraft,
    editBusy,
    codeEditBaseArtifactId,
    setCodeEditBaseArtifactId,
    codeEditInstruction,
    setCodeEditInstruction,
    codeEditDraft,
    setCodeEditDraft,
    codeEditBusy,
    workspaceStatus,
    workspaceStatusLoading,
    workspaceStatusLoadFailed,
    workspaceArtifactId,
    setWorkspaceArtifactId,
    workspaceRole,
    setWorkspaceRole,
    workspaceTask,
    workspaceBusy,
    workspaceInstruction,
    setWorkspaceInstruction,
    workspaceCodingTask,
    workspaceCodingTaskActive,
    workspaceCodingTaskPollingError,
    workspaceCommand,
    setWorkspaceCommand,
    workspaceCommandResult,
    workspaceDevServerCommand,
    setWorkspaceDevServerCommand,
    workspacePort,
    setWorkspacePort,
    workspacePreviewUrl,
    setWorkspacePreviewUrl,
    previewOpen,
    setPreviewOpen,
    previewTitle,
    previewHtml,
    sourceOpen,
    setSourceOpen,
    sourceTitle,
    sourceFiles,
    sourceFile,
    setSourceFile,
    refreshArtifactVersions,
    generateSelectedArtifacts,
    proposeArtifactEdit,
    applyArtifactEdit,
    proposeCodeArtifactEdit,
    applyCodeArtifactEdit,
    startWorkspace,
    runWorkspaceAgent,
    downloadCodingTaskReport,
    downloadCodingTaskLogs,
    reviewWorkspaceCodingTask,
    cancelWorkspaceCodingTask,
    resumeWorkspaceCodingTask,
    runWorkspaceCommand,
    startWorkspaceDevServer,
    stopWorkspaceDevServer,
    destroyWorkspace,
    openWorkspacePreview,
    exportWorkspace,
    previewArtifact,
    viewArtifactSource,
    downloadArtifact,
    simulateArtifactSync,
    restoreArtifactVersion,
  } = controller;
  const frontendArtifactTargets = [
    'vue-page',
    'react-page',
    'vue-dashboard',
    'react-dashboard',
  ];
  const workspaceArtifactVersions = artifactVersions.filter((artifact) => {
    if (artifact.kind !== 'code') return false;
    const target = artifact.metadata?.target;
    if (workspaceRole === 'backend') return target === 'nestjs-api';
    if (workspaceRole === 'frontend') {
      return frontendArtifactTargets.includes(String(target));
    }
    return frontendArtifactTargets.includes(String(target)) || target === 'nestjs-api';
  });
  const workspaceBoundTarget = artifactVersions.find(
    (artifact) => artifact.id === workspaceStatus?.artifactId,
  )?.metadata?.target;
  const workspaceRoleOptions =
    workspaceStatus?.artifactId && workspaceBoundTarget === 'nestjs-api'
      ? [
          { value: 'backend', label: '后端 Coding' },
          { value: 'qa', label: 'QA 验证' },
        ]
      : workspaceStatus?.artifactId &&
          frontendArtifactTargets.includes(String(workspaceBoundTarget))
        ? [
            { value: 'frontend', label: '前端 Coding' },
            { value: 'qa', label: 'QA 验证' },
          ]
        : [
            { value: 'frontend', label: '前端 Coding' },
            { value: 'backend', label: '后端 Coding' },
            { value: 'qa', label: 'QA 验证' },
          ];
  const qaReport =
    workspaceCodingTask?.taskType === 'verify' &&
    workspaceCodingTask.verification &&
    Array.isArray(workspaceCodingTask.verification.checks)
      ? (workspaceCodingTask.verification as ProductionQAReport)
      : null;
  const codingVerification =
    workspaceCodingTask?.taskType !== 'verify' &&
    workspaceCodingTask?.verification &&
    'diff' in workspaceCodingTask.verification
      ? (workspaceCodingTask.verification as ProductionCodingVerification)
      : null;
  const codingOutputArtifact =
    workspaceCodingTask?.taskType !== 'verify' &&
    workspaceCodingTask?.outputArtifactId
      ? artifactVersions.find(
          (artifact) =>
            artifact.id === workspaceCodingTask.outputArtifactId,
        )
      : undefined;
  return (
    <>
      <Card title="多形态产物工作台" style={{ marginTop: 16 }}>
        <p>
          从已审批工作流生成 Schema、Vue/React 页面或数字大屏。可多选；当前
          Schema 是工作流内部结构，真实平台组件 ID 和导入契约待确认，代码 ZIP 由
          Schema 生成。
        </p>
        <p>
          NestJS ZIP 当前提供可运行脚手架（health、tasks 示例和测试）；已审批业务范围仅写入 README，真实业务 API 仍需 Coding Agent 实现。
        </p>
        <Checkbox.Group
          options={ARTIFACT_OPTIONS}
          value={artifactTargets}
          onChange={(values) => {
            setArtifactTargets(values as ProductionArtifactTarget[]);
            setEditDraft(null);
          }}
        />
        <div style={{ marginTop: 12 }}>
          <Button
            type="primary"
            icon={<CodeOutlined />}
            loading={artifactBusy}
            disabled={artifactTargets.length === 0}
            onClick={() => void generateSelectedArtifacts()}
          >
            生成所选产物
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={artifactBusy}
            onClick={() => void refreshArtifactVersions()}
            style={{ marginLeft: 8 }}
          >
            刷新版本
          </Button>
          <Tag color="gold" style={{ marginLeft: 8 }}>
            低代码同步：模拟模式，不写入真实平台
          </Tag>
        </div>

        <section
          style={{
            marginTop: 20,
            padding: 16,
            background: '#f8fafc',
            borderRadius: 8,
          }}
        >
          <strong>自然语言修改 Schema</strong>
          <p style={{ margin: '6px 0 12px', color: '#667085' }}>
            先生成
            Schema。修改建议会先展示字段差异；点击“应用并生成新版本”后才会保存。代码版本可随新
            Schema 一起重新生成。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Select
              value={editTarget}
              style={{ width: 180 }}
              options={[
                { value: 'activity-schema', label: '活动页 Schema' },
                { value: 'dashboard-schema', label: '数字大屏 Schema' },
              ]}
              onChange={(value) => {
                setEditTarget(value);
                setEditBaseArtifactId('');
                setEditDraft(null);
              }}
            />
            <Select
              value={editBaseArtifactId || undefined}
              style={{ minWidth: 320, flex: '1 1 320px' }}
              placeholder="选择一个 Schema 版本"
              options={artifactVersions
                .filter(
                  (artifact) =>
                    artifact.kind === 'json' &&
                    artifact.metadata?.target === editTarget,
                )
                .map((artifact) => ({
                  value: artifact.id,
                  label: `${artifactLabel(artifact.metadata?.target)} v${String(artifact.metadata?.version ?? '?')} · ${new Date(artifact.createdAt).toLocaleString()}`,
                }))}
              onChange={(value) => {
                setEditBaseArtifactId(value);
                setEditDraft(null);
              }}
            />
          </div>
          <Input.TextArea
            rows={3}
            maxLength={4000}
            value={editInstruction}
            onChange={(event) => {
              setEditInstruction(event.target.value);
              setEditDraft(null);
            }}
            placeholder="例如：把页面标题改成春季预约活动，并增加一个规则说明区块"
            style={{ marginTop: 10 }}
          />
          <Button
            loading={editBusy}
            disabled={!editBaseArtifactId || !editInstruction.trim()}
            onClick={() => void proposeArtifactEdit()}
            style={{ marginTop: 8 }}
          >
            生成差异建议
          </Button>
          {editDraft && (
            <div style={{ marginTop: 14 }}>
              <strong>待确认差异（{editDraft.diff.length} 项）</strong>
              {editDraft.diff.length > 0 ? (
                <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>
                  {editDraft.diff.map((change) => (
                    <div
                      key={change.path}
                      style={{
                        borderTop: '1px solid #e4e7ec',
                        padding: '8px 0',
                      }}
                    >
                      <strong>{change.path}</strong>
                      <pre
                        style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}
                      >
                        {`原值：${change.before === undefined ? '（无）' : JSON.stringify(change.before, null, 2)}\n新值：${change.after === undefined ? '（无）' : JSON.stringify(change.after, null, 2)}`}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p>没有字段变化。</p>
              )}
              <Button
                type="primary"
                loading={editBusy}
                disabled={editDraft.diff.length === 0}
                onClick={() => void applyArtifactEdit()}
              >
                应用并生成新版本
              </Button>
            </div>
          )}
        </section>

        <section
          style={{
            marginTop: 20,
            padding: 16,
            background: '#fffaf0',
            borderRadius: 8,
          }}
        >
          <strong>自然语言修改生成代码</strong>
          <p style={{ margin: '6px 0 12px', color: '#667085' }}>
            选择已有 Vue、React
            或大屏代码版本，描述修改要求。NestJS 后端项目请通过上方隔离工作区 Coding Task 修改。系统会先展示文件差异并编译预览；确认后保存为新
            ZIP 版本。只修改页面组件和样式，不修改依赖、构建配置或关联 Schema。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Select
              value={codeEditBaseArtifactId || undefined}
              style={{ minWidth: 360, flex: '1 1 360px' }}
              placeholder="选择一个 Vue / React / 大屏代码版本"
              options={artifactVersions
                .filter(
                  (artifact) =>
                    artifact.kind === 'code' &&
                    artifact.metadata?.target !== 'nestjs-api',
                )
                .map((artifact) => ({
                  value: artifact.id,
                  label: `${artifactLabel(artifact.metadata?.target)} v${String(artifact.metadata?.version ?? '?')} · ${new Date(artifact.createdAt).toLocaleString()}`,
                }))}
              onChange={(value) => {
                setCodeEditBaseArtifactId(value);
                setCodeEditDraft(null);
              }}
            />
          </div>
          <Input.TextArea
            rows={3}
            maxLength={4000}
            value={codeEditInstruction}
            onChange={(event) => {
              setCodeEditInstruction(event.target.value);
              setCodeEditDraft(null);
            }}
            placeholder="例如：把主视觉标题改成春季预约活动，卡片改成两列布局，按钮使用深绿色"
            style={{ marginTop: 10 }}
          />
          <Button
            loading={codeEditBusy}
            disabled={!codeEditBaseArtifactId || !codeEditInstruction.trim()}
            onClick={() => void proposeCodeArtifactEdit()}
            style={{ marginTop: 8 }}
          >
            生成代码差异和预览
          </Button>
          {codeEditDraft && (
            <div style={{ marginTop: 14 }}>
              <strong>
                待确认代码修改（{codeEditDraft.diff.length} 个文件）
              </strong>
              {codeEditDraft.diff.map((change) => (
                <details key={change.path} style={{ marginTop: 8 }}>
                  <summary>{change.path}</summary>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(280px, 1fr))',
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <div>
                      <strong>修改前</strong>
                      <pre
                        style={{
                          maxHeight: 220,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {change.before}
                      </pre>
                    </div>
                    <div>
                      <strong>修改后</strong>
                      <pre
                        style={{
                          maxHeight: 220,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {change.after}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
              <iframe
                title="代码修改候选预览"
                srcDoc={codeEditDraft.previewHtml}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                style={{
                  width: '100%',
                  height: 360,
                  marginTop: 12,
                  border: '1px solid #eaecf0',
                }}
              />
              <Button
                type="primary"
                loading={codeEditBusy}
                disabled={!codeEditDraft.diff.length}
                onClick={() => void applyCodeArtifactEdit()}
                style={{ marginTop: 8 }}
              >
                应用代码并保存新 ZIP 版本
              </Button>
            </div>
          )}
        </section>

        <div style={{ marginTop: 20 }}>
          <strong>版本记录</strong>
          {artifactVersions.length === 0 ? (
            <p style={{ color: '#667085' }}>暂无版本，先选择产物并生成。</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              {artifactVersions.map((artifact) => {
                const target = artifact.metadata?.target;
                const version = Number(artifact.metadata?.version ?? 0);
                const sameTarget = artifactVersions.filter(
                  (item) => item.metadata?.target === target,
                );
                const latest = Math.max(
                  0,
                  ...sameTarget.map((item) =>
                    Number(item.metadata?.version ?? 0),
                  ),
                );
                const isSchema =
                  target === 'activity-schema' || target === 'dashboard-schema';
                const lastSync = artifact.metadata?.lastSimulatedSync as
                  | { objectId?: string }
                  | undefined;
                return (
                  <div
                    key={artifact.id}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                      borderTop: '1px solid #eaecf0',
                      padding: '10px 0',
                    }}
                  >
                    <Tag color={isSchema ? 'blue' : 'purple'}>
                      {artifactLabel(target)}
                    </Tag>
                    <Tag>v{version || '?'}</Tag>
                    {artifact.metadata?.schemaOutOfSync === true && (
                      <Tag color="orange">源码已独立修改，Schema 未同步</Tag>
                    )}
                    <span style={{ color: '#667085', flex: '1 1 180px' }}>
                      {new Date(artifact.createdAt).toLocaleString()} ·{' '}
                      {artifact.filename}
                    </span>
                    {lastSync?.objectId && (
                      <Tag color="gold">模拟 ID：{lastSync.objectId}</Tag>
                    )}
                    {target !== 'nestjs-api' && (
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => void previewArtifact(artifact)}
                      >
                        预览
                      </Button>
                    )}
                    <Button
                      size="small"
                      icon={<CodeOutlined />}
                      onClick={() => void viewArtifactSource(artifact)}
                    >
                      查看源文件
                    </Button>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => void downloadArtifact(artifact)}
                    >
                      下载
                    </Button>
                    {target === 'activity-schema' && (
                      <Button
                        size="small"
                        icon={<CloudSyncOutlined />}
                        onClick={() => void simulateArtifactSync(artifact)}
                      >
                        模拟同步
                      </Button>
                    )}
                    {isSchema && version < latest && (
                      <Button
                        size="small"
                        icon={<HistoryOutlined />}
                        onClick={() => void restoreArtifactVersion(artifact)}
                      >
                        恢复为新版本
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      <Card title="Agent 项目开发工作区" style={{ marginTop: 16 }}>
        <p>
          在 OpenSandbox 隔离工作区里按岗位运行 Coding Agent 或受控 QA
          验证。QA 只能运行固定的 lint/test/build 检查，不会修改代码；所有结果保留人工审阅状态。
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Select
            value={workspaceRole}
            style={{ width: 150 }}
            disabled={
              workspaceStatusLoading ||
              workspaceStatusLoadFailed ||
              workspaceCodingTaskActive ||
              workspaceBusy
            }
            options={workspaceRoleOptions}
            onChange={(value) => {
              setWorkspaceRole(value);
              if (!workspaceStatus?.artifactId) setWorkspaceArtifactId('');
              setWorkspacePreviewUrl('');
            }}
          />
          <Select
            value={workspaceTask}
            style={{ width: 110 }}
            disabled
            options={[
              {
                value: workspaceTask,
                label: workspaceTask === 'verify' ? 'verify' : 'code',
              },
            ]}
          />
          <Select
            value={workspaceArtifactId || undefined}
            style={{ minWidth: 360, flex: '1 1 360px' }}
            placeholder="选择与岗位匹配的代码 ZIP"
            disabled={
              workspaceStatusLoading ||
              workspaceStatusLoadFailed ||
              !workspaceStatus ||
              Boolean(workspaceStatus?.artifactId) ||
              workspaceCodingTaskActive
            }
            options={workspaceArtifactVersions.map((artifact) => ({
                value: artifact.id,
                label: `${artifactLabel(artifact.metadata?.target)} v${String(artifact.metadata?.version ?? '?')} · ${new Date(artifact.createdAt).toLocaleString()}`,
              }))}
            onChange={(value) => {
              setWorkspaceArtifactId(value);
              setWorkspacePreviewUrl('');
            }}
          />
          <Button
            type="primary"
            loading={workspaceBusy}
            disabled={
              !workspaceArtifactId ||
              workspaceStatusLoading ||
              workspaceStatusLoadFailed ||
              !workspaceStatus ||
              workspaceCodingTaskActive ||
              workspaceBusy
            }
            onClick={() => void startWorkspace()}
          >
            启动 / 恢复工作区
          </Button>
          <Tag color={workspaceStatus?.ready ? 'green' : 'default'}>
            {workspaceStatus?.ready
              ? `工作区已就绪${workspaceStatus.projectRoot ? ` · ${workspaceStatus.projectRoot}` : ''}`
              : workspaceStatus?.artifactId
                ? '工作区记录已存在但当前不可用'
                : '工作区未启动'}
          </Tag>
          <Button
            danger
            loading={workspaceBusy}
            disabled={!workflow || workspaceBusy || workspaceCodingTaskActive}
            onClick={destroyWorkspace}
          >
            销毁工作区
          </Button>
        </div>
        {workspaceStatusLoading ? (
          <div style={{ marginTop: 8, color: '#667085' }}>
            正在检查当前工作区
          </div>
        ) : workspaceStatusLoadFailed ? (
          <Alert
            type="warning"
            showIcon
            title="无法确认当前工作区"
            description="为避免覆盖仍存在的工作区，已禁用选择、启动和 Agent 执行。请刷新页面后重试。"
            style={{ marginTop: 8 }}
          />
        ) : workspaceStatus?.artifactId ? (
          <div style={{ marginTop: 8, color: '#667085' }}>
            当前工作区绑定代码版本 {workspaceArtifactId}。切换版本前请先导出当前工作区 ZIP，再销毁工作区。
          </div>
        ) : null}

        <section
          style={{
            marginTop: 16,
            padding: 16,
            background: '#f8fafc',
            borderRadius: 8,
          }}
        >
          <strong>{workspaceTask === 'verify' ? '提交 QA 验证' : '让 Agent 开发'}</strong>
          <Input.TextArea
            rows={3}
            maxLength={4000}
            value={workspaceInstruction}
            onChange={(event) => setWorkspaceInstruction(event.target.value)}
            placeholder={
              workspaceTask === 'verify'
                ? '填写本次验证目标或验收要求；Agent 只会执行固定 lint/test/build 检查'
                : '例如：修复构建报错，再运行测试并说明结果'
            }
            disabled={workspaceCodingTaskActive || workspaceBusy}
            style={{ marginTop: 10 }}
          />
          <Button
            type="primary"
            loading={workspaceBusy}
            disabled={
              !workspaceArtifactId ||
              !workspaceInstruction.trim() ||
              workspaceCodingTaskActive ||
              workspaceBusy ||
              workspaceStatusLoading ||
              workspaceStatusLoadFailed ||
              !workspaceStatus
            }
            onClick={() => void runWorkspaceAgent()}
            style={{ marginTop: 8 }}
          >
            {workspaceTask === 'verify' ? '提交受控验证任务' : '提交异步开发任务'}
          </Button>
          {workspaceCodingTaskActive && (
            <Button
              danger
              loading={workspaceBusy}
              disabled={workspaceBusy}
              onClick={() => void cancelWorkspaceCodingTask()}
              style={{ marginTop: 8, marginLeft: 8 }}
            >
              取消任务
            </Button>
          )}
          {workspaceCodingTask && (
            <div style={{ marginTop: 12 }}>
              <Tag
                color={codingTaskTagColor(workspaceCodingTask.status)}
              >
                {CODING_TASK_STATUS_LABELS[workspaceCodingTask.status] ??
                  workspaceCodingTask.status}
              </Tag>
              <div style={{ color: '#667085', marginTop: 4 }}>
                Task {workspaceCodingTask.taskId}
                {workspaceCodingTask.runId
                  ? ` · Run ${workspaceCodingTask.runId}`
                  : ''}
                {workspaceCodingTask.parentRunId
                  ? ` · Parent Run ${workspaceCodingTask.parentRunId}`
                  : ''}
                {workspaceCodingTask.artifactId
                  ? ` · Artifact ${workspaceCodingTask.artifactId}`
                  : ''}
                {` · 尝试 ${workspaceCodingTask.attempt} · 已完成步骤 ${workspaceCodingTask.lastCompletedStep}`}
              </div>
              {(workspaceCodingTask.summary || workspaceCodingTask.error) && (
                <p style={{ whiteSpace: 'pre-wrap' }}>
                  {workspaceCodingTask.summary || workspaceCodingTask.error}
                </p>
              )}
              {workspaceCodingTaskPollingError && (
                <Alert
                  type="warning"
                  showIcon
                  title="任务状态暂时无法刷新"
                  description={`${workspaceCodingTaskPollingError}，页面会继续重试。`}
                  style={{ marginTop: 8 }}
                />
              )}
              {(['failed', 'blocked'] as string[]).includes(
                workspaceCodingTask.status,
              ) && (
                <Button
                  loading={workspaceBusy}
                  disabled={workspaceBusy}
                  onClick={() => void resumeWorkspaceCodingTask()}
                >
                  安全续跑
                </Button>
              )}
              {workspaceCodingTask.events.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary>运行事件（{workspaceCodingTask.events.length}）</summary>
                  {workspaceCodingTask.events.map((event) => (
                    <div
                      key={`${event.sequence}-${event.eventType}`}
                      style={{ borderTop: '1px solid #eaecf0', padding: 8 }}
                    >
                      <strong>{event.eventType}</strong>
                      <span style={{ marginLeft: 8, color: '#667085' }}>
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          margin: '4px 0 0',
                        }}
                      >
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                </details>
              )}
              {qaReport && (
                <div style={{ marginTop: 12 }}>
                  <strong>QA 验证报告</strong>
                  <div style={{ marginTop: 6 }}>
                    <Tag color={codingTaskTagColor(qaReport.status)}>
                      {qaReport.status === 'passed'
                        ? '质量门禁通过'
                        : qaReport.status === 'failed'
                          ? '质量门禁失败'
                          : qaReport.status === 'incomplete'
                            ? '检查不完整'
                            : '没有可用检查结果'}
                    </Tag>
                    {workspaceCodingTask.status === 'waiting_review' && (
                      <Tag color="gold">待人工审阅</Tag>
                    )}
                    {workspaceCodingTask.status === 'approved' && (
                      <Tag color="green">已人工批准</Tag>
                    )}
                    {workspaceCodingTask.status === 'rejected' && (
                      <Tag color="red">已人工驳回</Tag>
                    )}
                    <span style={{ color: '#667085' }}>
                      {`产物 ${qaReport.artifactId} v${qaReport.artifactVersion} · Trace ${qaReport.traceId}`}
                    </span>
                  </div>
                  <p>{qaReport.summary}</p>
                  <div style={{ color: '#667085', marginBottom: 8 }}>
                    必需检查：{qaReport.requiredChecks?.join(', ') || '无'} ·
                    适用检查：{qaReport.applicableChecks?.join(', ') || '无'} ·
                    跳过检查：{qaReport.skippedChecks?.join(', ') || '无'}
                  </div>
                  <strong>检查结果</strong>
                  {qaReport.checks.map((check) => (
                    <div
                      key={check.name}
                      style={{ borderTop: '1px solid #eaecf0', padding: 8 }}
                    >
                      <Tag color={codingTaskTagColor(check.status)}>
                        {check.name}: {CHECK_STATUS_LABELS[check.status]}
                      </Tag>
                      {check.outputTruncated && (
                        <Tag color="orange">输出超过限制，以下为预览</Tag>
                      )}
                      {check.exitCode !== null && (
                        <span style={{ marginLeft: 8 }}>
                          exit {check.exitCode}
                        </span>
                      )}
                      {check.summary && (
                        <pre
                          style={{
                            maxHeight: 260,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            margin: '6px 0 0',
                          }}
                        >
                          {check.summary}
                        </pre>
                      )}
                    </div>
                  ))}
                  <strong>诊断</strong>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{qaReport.diagnosis}</p>
                  {qaReport.suggestedFixes.length > 0 && (
                    <>
                      <strong>建议修改</strong>
                      <ul>
                        {qaReport.suggestedFixes.map((fix) => (
                          <li key={fix}>{fix}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <Button
                    icon={<DownloadOutlined />}
                    disabled={!workspaceCodingTask.outputArtifactId}
                    onClick={() => void downloadCodingTaskReport()}
                  >
                    下载 QA 报告 JSON
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    disabled={!qaReport.logsArtifactId}
                    onClick={() => void downloadCodingTaskLogs()}
                  >
                    下载检查日志 Artifact
                  </Button>
                  {qaReport.review ? (
                    <Alert
                      type={qaReport.review.decision === 'approved' ? 'success' : 'error'}
                      showIcon
                      title={qaReport.review.decision === 'approved' ? 'QA 已批准' : 'QA 已驳回'}
                      description={
                        <>
                          <div>
                            审阅人 {qaReport.review.reviewerUserId} ·{' '}
                            {new Date(qaReport.review.reviewedAt).toLocaleString()}
                          </div>
                          <div>
                            QA Artifact {qaReport.review.qaReportArtifactId} v
                            {qaReport.review.artifactVersion}
                          </div>
                          {qaReport.review.comment && <div>意见：{qaReport.review.comment}</div>}
                          {qaReport.review.remediationArtifactId && (
                            <div>待修复产物：{qaReport.review.remediationArtifactId}</div>
                          )}
                          {qaReport.review.remediationTaskId && (
                            <div>关联修复任务：{qaReport.review.remediationTaskId}</div>
                          )}
                        </>
                      }
                      style={{ marginTop: 8 }}
                    />
                  ) : workspaceCodingTask.status === 'waiting_review' ? (
                    <>
                      <Alert
                        type={qaReport.status === 'failed' ? 'error' : 'warning'}
                        showIcon
                        title="QA 结果等待人工审阅"
                        description="固定 lint/test/build 只执行一轮并生成诊断，不会修改代码或自动重测。修复后请基于新代码提交新的 QA 任务。Run 完成表示检查流程执行结束；质量门禁见报告状态。"
                        style={{ marginTop: 8 }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <Button
                          type="primary"
                          disabled={workspaceBusy}
                          onClick={() => void reviewWorkspaceCodingTask('approved')}
                        >
                          批准 QA 结果
                        </Button>
                        <Button
                          danger
                          disabled={workspaceBusy}
                          onClick={() => {
                            let comment = '';
                            Modal.confirm({
                              title: '驳回 QA 结果',
                              content: (
                                <Input.TextArea
                                  autoSize={{ minRows: 3, maxRows: 8 }}
                                  maxLength={2000}
                                  placeholder="填写驳回原因和需要修复的内容"
                                  onChange={(event) => {
                                    comment = event.target.value;
                                  }}
                                />
                              ),
                              okText: '确认驳回',
                              cancelText: '取消',
                              okButtonProps: { danger: true },
                              onOk: () => {
                                if (!comment.trim()) {
                                  message.error('请填写驳回意见');
                                  return Promise.reject(new Error('comment required'));
                                }
                                return reviewWorkspaceCodingTask('rejected', comment);
                              },
                            });
                          }}
                        >
                          驳回并记录意见
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
              {codingVerification && (
                <div style={{ marginTop: 12 }}>
                  <strong>文件差异</strong>
                  {(['added', 'modified', 'deleted'] as const).map((kind) => {
                    const files = codingVerification.diff[kind];
                    return (
                      <div key={kind} style={{ marginTop: 4 }}>
                        <span>
                          {kind === 'added'
                            ? '新增'
                            : kind === 'modified'
                              ? '修改'
                              : '删除'}
                          （{files.length}）
                        </span>
                        {files.length > 0 && (
                          <ul style={{ margin: '2px 0 4px' }}>
                            {files.map((file) => (
                              <li key={file.path}>
                                <code>{file.path}</code>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  <strong style={{ display: 'block', marginTop: 12 }}>
                    验证结果 ·{' '}
                    {new Date(
                      codingVerification.checkedAt,
                    ).toLocaleString()}
                  </strong>
                  {Object.entries(codingVerification.checks).map(
                    ([name, check]) => (
                      <div
                        key={name}
                        style={{ borderTop: '1px solid #eaecf0', padding: 8 }}
                      >
                        <Tag color={codingTaskTagColor(check.status)}>
                          {name}: {CHECK_STATUS_LABELS[check.status]}
                        </Tag>
                        {check.command && <code>{check.command}</code>}
                        {check.exitCode !== null && (
                          <span style={{ marginLeft: 8 }}>
                            exit {check.exitCode}
                          </span>
                        )}
                        {check.reason && (
                          <div style={{ color: '#667085', marginTop: 4 }}>
                            {check.reason}
                          </div>
                        )}
                        {check.output && (
                          <details style={{ marginTop: 4 }}>
                            <summary>查看输出</summary>
                            <pre
                              style={{
                                maxHeight: 260,
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {check.output}
                            </pre>
                          </details>
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
              {codingOutputArtifact && (
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => void downloadArtifact(codingOutputArtifact)}
                >
                  下载 Coding ZIP
                </Button>
              )}
              {workspaceCodingTask.status === 'completed' && (
                <Alert
                  type="success"
                  showIcon
                  title="任务已完成，差异与适用检查均通过"
                  style={{ marginTop: 8 }}
                />
              )}
              {workspaceCodingTask.status === 'waiting_review' && (
                <Alert
                  type="warning"
                  showIcon
                  title="任务需要人工验收"
                  description="没有代码差异或没有适用的 lint/test/build 检查，不能自动判定为完成。"
                  style={{ marginTop: 8 }}
                />
              )}
              {workspaceCodingTask.status === 'waiting_reconciliation' && (
                <Alert
                  type="warning"
                  showIcon
                  title="任务需要人工对账"
                  description="检测到结果不确定的工具副作用，系统不会盲目重放。"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          )}
        </section>

        {workspaceRole !== 'qa' && (
        <section style={{ marginTop: 16 }}>
          <strong>手动执行命令</strong>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Input
              value={workspaceCommand}
              onChange={(event) => setWorkspaceCommand(event.target.value)}
              onPressEnter={() => void runWorkspaceCommand()}
              placeholder="例如：npm test"
              disabled={
                !workspaceStatus?.ready || workspaceBusy || workspaceCodingTaskActive
              }
            />
            <Button
              loading={workspaceBusy}
              disabled={
                !workspaceStatus?.ready ||
                !workspaceCommand.trim() ||
                workspaceBusy ||
                workspaceCodingTaskActive
              }
              onClick={() => void runWorkspaceCommand()}
            >
              执行
            </Button>
          </div>
          {workspaceCommandResult && (
            <pre
              style={{
                maxHeight: 260,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {`exit ${workspaceCommandResult.exitCode}\n${workspaceCommandResult.output}`}
            </pre>
          )}
        </section>
        )}

        {workspaceRole !== 'qa' && (
        <section style={{ marginTop: 16 }}>
          <strong>开发服务器与预览</strong>
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}
          >
            <Input
              value={workspaceDevServerCommand}
              onChange={(event) =>
                setWorkspaceDevServerCommand(event.target.value)
              }
              placeholder="npm run dev -- --host 0.0.0.0"
              style={{ flex: '1 1 360px' }}
              disabled={
                !workspaceStatus?.ready || workspaceBusy || workspaceCodingTaskActive
              }
            />
            <Input
              value={workspacePort}
              onChange={(event) => setWorkspacePort(event.target.value)}
              placeholder="端口"
              style={{ width: 110 }}
              disabled={
                !workspaceStatus?.ready || workspaceBusy || workspaceCodingTaskActive
              }
            />
            <Button
              loading={workspaceBusy}
              disabled={
                !workspaceStatus?.ready ||
                !workspaceDevServerCommand.trim() ||
                workspaceBusy ||
                workspaceCodingTaskActive
              }
              onClick={() => void startWorkspaceDevServer()}
            >
              启动服务器
            </Button>
            <Button
              loading={workspaceBusy}
              disabled={
                !workspaceStatus?.devServer || workspaceBusy || workspaceCodingTaskActive
              }
              onClick={() => void stopWorkspaceDevServer()}
            >
              停止服务器
            </Button>
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready || workspaceBusy || workspaceCodingTaskActive}
              onClick={() => void openWorkspacePreview()}
            >
              打开预览
            </Button>
            <Button
              icon={<DownloadOutlined />}
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready || workspaceBusy || workspaceCodingTaskActive}
              onClick={() => void exportWorkspace()}
            >
              导出新 ZIP
            </Button>
          </div>
          {workspacePreviewUrl && (
            <iframe
              title="Agent 开发工作区预览"
              src={workspacePreviewUrl}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              style={{
                width: '100%',
                height: 560,
                marginTop: 12,
                border: '1px solid #eaecf0',
              }}
            />
          )}
        </section>
        )}
      </Card>
      <Modal
        title={previewTitle}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={1200}
        style={{ top: 24 }}
        destroyOnHidden
      >
        <iframe
          title={previewTitle}
          srcDoc={previewHtml}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '72vh', border: '1px solid #eaecf0' }}
        />
      </Modal>
      <Modal
        title={sourceTitle}
        open={sourceOpen}
        onCancel={() => setSourceOpen(false)}
        footer={null}
        width={1000}
        destroyOnHidden
      >
        {Object.keys(sourceFiles).length > 1 && (
          <Select
            value={sourceFile}
            options={Object.keys(sourceFiles).map((path) => ({
              value: path,
              label: path,
            }))}
            onChange={setSourceFile}
            style={{ width: '100%', marginBottom: 12 }}
          />
        )}
        <pre
          style={{
            maxHeight: '70vh',
            overflow: 'auto',
            background: '#101828',
            color: '#e4e7ec',
            padding: 16,
            borderRadius: 8,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {sourceFiles[sourceFile] ?? ''}
        </pre>
      </Modal>
    </>
  );
}
