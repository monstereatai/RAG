import {
  CloseOutlined,
  ExportOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import { history } from '@umijs/max';
import { Button, Card, Collapse, Descriptions, Steps, Tag } from 'antd';
import type { WorkflowDetailLoadedController } from './workflow-detail-controller';
import {
  normalizeMarkdown,
  ROLE_LABELS,
  SpaceButtons,
  STATUS_LABELS,
} from './workflow-detail-shared';

export function renderWorkflowOverview(
  controller: WorkflowDetailLoadedController,
) {
  const {
    workflow,
    loading,
    submitting,
    exporting,
    generatingProject,
    loadDetail,
    handleCancel,
    exportMarkdownDirectory,
    generateRunnableProject,
    previewPlaywayPage,
    syncPlaywayGraph,
  } = controller;
  return (
    <>
      <Card
        title={`${workflow.projectId}／工作流详情`}
        extra={
          <span>
            <SpaceButtons
              onBack={() => history.push('/agent-ops')}
              onRefresh={() => void loadDetail()}
              loading={loading}
            />
            {['running', 'pending_approval', 'revision_required'].includes(
              workflow.status,
            ) && (
              <Button
                danger
                icon={<CloseOutlined />}
                loading={submitting}
                onClick={handleCancel}
                style={{ marginLeft: 8 }}
              >
                取消工作流
              </Button>
            )}
            {workflow.status === 'completed' && (
              <>
                <Button
                  icon={<ExportOutlined />}
                  loading={exporting}
                  onClick={() => void exportMarkdownDirectory()}
                  style={{ marginLeft: 8 }}
                >
                  导出交接包（Markdown＋Schema）
                </Button>
                <Button
                  onClick={() => void previewPlaywayPage()}
                  style={{ marginLeft: 8 }}
                >
                  预览 Playway 活动页
                </Button>
                <Button
                  onClick={() => void syncPlaywayGraph()}
                  style={{ marginLeft: 8 }}
                >
                  同步活动图谱
                </Button>
                <Button
                  type="primary"
                  icon={<FolderOpenOutlined />}
                  loading={generatingProject}
                  onClick={() => void generateRunnableProject()}
                  style={{ marginLeft: 8 }}
                >
                  生成可运行项目代码
                </Button>
              </>
            )}
          </span>
        }
      >
        <Steps
          current={workflow.stageIndex}
          items={workflow.selectedRoles.map((role, index) => ({
            title: ROLE_LABELS[role],
            status:
              ['failed', 'cancelled'].includes(workflow.status) &&
              index === workflow.stageIndex
                ? 'error'
                : workflow.completedRoles.includes(role)
                  ? 'finish'
                  : workflow.currentBatch.includes(role)
                    ? 'process'
                    : 'wait',
          }))}
        />
        <Descriptions
          column={2}
          style={{ marginTop: 24 }}
          items={[
            {
              key: 'status',
              label: '状态',
              children: (
                <Tag
                  color={
                    workflow.status === 'completed'
                      ? 'green'
                      : workflow.status === 'failed'
                        ? 'red'
                        : workflow.status === 'cancelled'
                          ? 'default'
                          : workflow.status === 'pending_approval' ||
                              workflow.status === 'revision_required'
                            ? 'orange'
                            : 'blue'
                  }
                >
                  {STATUS_LABELS[workflow.status]}
                </Tag>
              ),
            },
            {
              key: 'steps',
              label: '执行步数',
              children: `${workflow.stepCount}/${workflow.maxSteps}`,
            },
            { key: 'thread', label: 'Thread ID', children: workflow.threadId },
            {
              key: 'batch',
              label: '当前批次',
              children:
                workflow.currentBatch
                  .map((role) => ROLE_LABELS[role])
                  .join('＋') || '已完成',
            },
            {
              key: 'approval',
              label: '审批策略',
              children: workflow.approvalMode,
            },
            {
              key: 'error',
              label: '错误信息',
              children: workflow.error || '无',
            },
          ]}
        />
      </Card>
      {(workflow.schemaIssues?.length ?? 0) > 0 && (
        <Card title="Schema 闭合校验" style={{ marginTop: 16 }}>
          {workflow.schemaIssues?.map((issue) => (
            <p key={issue} style={{ color: '#d4380d', marginBottom: 6 }}>
              {issue}
            </p>
          ))}
        </Card>
      )}
      <Card title="阶段产物" style={{ marginTop: 16 }}>
        <Collapse
          items={workflow.selectedRoles
            .filter((role) => workflow.results[role])
            .map((role) => {
              const result = workflow.results[role];
              if (!result) return null;
              return {
                key: role,
                label: (
                  <span>
                    {ROLE_LABELS[role]}：{result.summary}{' '}
                    <Tag>v{result.revision ?? 1}</Tag>
                    <Tag
                      color={
                        result.reviewStatus === 'approved'
                          ? 'green'
                          : result.reviewStatus === 'rejected'
                            ? 'red'
                            : result.reviewStatus === 'stale'
                              ? 'orange'
                              : 'blue'
                      }
                    >
                      {result.reviewStatus ?? 'pending'}
                    </Tag>
                    <Tag
                      color={
                        result.riskLevel === 'high'
                          ? 'red'
                          : result.riskLevel === 'medium'
                            ? 'orange'
                            : 'green'
                      }
                    >
                      风险：{result.riskLevel}
                    </Tag>
                    <Tag
                      color={result.evidenceCoverage === 1 ? 'green' : 'orange'}
                    >
                      证据覆盖：{Math.round(result.evidenceCoverage * 100)}%
                    </Tag>
                  </span>
                ),
                children: (
                  <div className="agent-stage-output">
                    {result.deliverables.map((deliverable) => (
                      <section key={`${deliverable.type}-${deliverable.title}`}>
                        <strong>{deliverable.title}</strong>
                        <XMarkdown
                          content={normalizeMarkdown(deliverable.markdown)}
                          escapeRawHtml
                          openLinksInNewTab
                          paragraphTag="div"
                        />
                      </section>
                    ))}
                    {Array.isArray(result.lowCodeSchemas) &&
                      result.lowCodeSchemas.length > 0 && (
                        <section>
                          <strong>低代码 / AI Coding Schema</strong>
                          <pre
                            style={{
                              maxHeight: 360,
                              overflow: 'auto',
                              background: '#f8fafc',
                              border: '1px solid #eaecf0',
                              borderRadius: 8,
                              padding: 12,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {JSON.stringify(result.lowCodeSchemas, null, 2)}
                          </pre>
                        </section>
                      )}
                    <p>问题：{result.issues.join('；') || '无'}</p>
                    <p>下游风险：{result.downstreamRisks.join('；') || '无'}</p>
                  </div>
                ),
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)}
        />
      </Card>
    </>
  );
}
