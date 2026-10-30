import {
  CloudSyncOutlined,
  CodeOutlined,
  DownloadOutlined,
  EyeOutlined,
  HistoryOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Card, Checkbox, Input, Modal, Select, Tag } from 'antd';
import type { ProductionArtifactTarget } from '../service';
import type { WorkflowDetailLoadedController } from './workflow-detail-controller';
import { ARTIFACT_OPTIONS, artifactLabel } from './workflow-detail-shared';

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
    workspaceArtifactId,
    setWorkspaceArtifactId,
    workspaceBusy,
    workspaceInstruction,
    setWorkspaceInstruction,
    workspaceAgentResult,
    setWorkspaceAgentResult,
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
  return (
    <>
      <Card title="多形态产物工作台" style={{ marginTop: 16 }}>
        <p>
          从已审批工作流生成 Schema、Vue/React 页面或数字大屏。可多选；当前
          Schema 是工作流内部结构，真实平台组件 ID 和导入契约待确认，代码 ZIP 由
          Schema 生成。
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
            或大屏代码版本，描述修改要求。系统会先展示文件差异并编译预览；确认后保存为新
            ZIP 版本。只修改页面组件和样式，不修改依赖、构建配置或关联 Schema。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Select
              value={codeEditBaseArtifactId || undefined}
              style={{ minWidth: 360, flex: '1 1 360px' }}
              placeholder="选择一个 Vue / React / 大屏代码版本"
              options={artifactVersions
                .filter((artifact) => artifact.kind === 'code')
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
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => void previewArtifact(artifact)}
                    >
                      预览
                    </Button>
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
          在 OpenSandbox 隔离工作区里让 Agent
          修改项目、安装依赖和运行测试；可启动开发服务器预览，并把工作区导出为新的
          ZIP 版本。工作区中的改动不会自动覆盖原始产物。
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
            value={workspaceArtifactId || undefined}
            style={{ minWidth: 360, flex: '1 1 360px' }}
            placeholder="选择用于开发的 Vue / React 项目 ZIP"
            options={artifactVersions
              .filter((artifact) => artifact.kind === 'code')
              .map((artifact) => ({
                value: artifact.id,
                label: `${artifactLabel(artifact.metadata?.target)} v${String(artifact.metadata?.version ?? '?')} · ${new Date(artifact.createdAt).toLocaleString()}`,
              }))}
            onChange={(value) => {
              setWorkspaceArtifactId(value);
              setWorkspaceAgentResult(null);
              setWorkspacePreviewUrl('');
            }}
          />
          <Button
            type="primary"
            loading={workspaceBusy}
            disabled={!workspaceArtifactId}
            onClick={() => void startWorkspace()}
          >
            启动 / 恢复工作区
          </Button>
          <Tag color={workspaceStatus?.ready ? 'green' : 'default'}>
            {workspaceStatus?.ready
              ? `工作区已就绪${workspaceStatus.projectRoot ? ` · ${workspaceStatus.projectRoot}` : ''}`
              : '工作区未启动'}
          </Tag>
          <Button
            danger
            loading={workspaceBusy}
            disabled={!workflow || workspaceBusy}
            onClick={destroyWorkspace}
          >
            销毁工作区
          </Button>
        </div>

        <section
          style={{
            marginTop: 16,
            padding: 16,
            background: '#f8fafc',
            borderRadius: 8,
          }}
        >
          <strong>让 Agent 开发</strong>
          <Input.TextArea
            rows={3}
            maxLength={4000}
            value={workspaceInstruction}
            onChange={(event) => setWorkspaceInstruction(event.target.value)}
            placeholder="例如：安装项目依赖，修复构建报错，再运行测试并说明结果"
            style={{ marginTop: 10 }}
          />
          <Button
            type="primary"
            loading={workspaceBusy}
            disabled={!workspaceArtifactId || !workspaceInstruction.trim()}
            onClick={() => void runWorkspaceAgent()}
            style={{ marginTop: 8 }}
          >
            执行开发任务
          </Button>
          {workspaceAgentResult && (
            <div style={{ marginTop: 12 }}>
              <Tag
                color={
                  workspaceAgentResult.status === 'completed'
                    ? 'green'
                    : 'orange'
                }
              >
                {workspaceAgentResult.status === 'completed'
                  ? '任务完成'
                  : '任务未完成'}
              </Tag>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {workspaceAgentResult.summary}
              </p>
              {workspaceAgentResult.steps?.map((step) => (
                <details
                  key={`${step.command}-${step.exitCode}`}
                  style={{ marginTop: 8 }}
                >
                  <summary>
                    {step.command} · exit {step.exitCode}
                  </summary>
                  <pre
                    style={{
                      maxHeight: 260,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {step.output}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <strong>手动执行命令</strong>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Input
              value={workspaceCommand}
              onChange={(event) => setWorkspaceCommand(event.target.value)}
              onPressEnter={() => void runWorkspaceCommand()}
              placeholder="例如：npm test"
              disabled={!workspaceStatus?.ready || workspaceBusy}
            />
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready || !workspaceCommand.trim()}
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
              disabled={!workspaceStatus?.ready || workspaceBusy}
            />
            <Input
              value={workspacePort}
              onChange={(event) => setWorkspacePort(event.target.value)}
              placeholder="端口"
              style={{ width: 110 }}
              disabled={!workspaceStatus?.ready || workspaceBusy}
            />
            <Button
              loading={workspaceBusy}
              disabled={
                !workspaceStatus?.ready || !workspaceDevServerCommand.trim()
              }
              onClick={() => void startWorkspaceDevServer()}
            >
              启动服务器
            </Button>
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.devServer || workspaceBusy}
              onClick={() => void stopWorkspaceDevServer()}
            >
              停止服务器
            </Button>
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready}
              onClick={() => void openWorkspacePreview()}
            >
              打开预览
            </Button>
            <Button
              icon={<DownloadOutlined />}
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready}
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
