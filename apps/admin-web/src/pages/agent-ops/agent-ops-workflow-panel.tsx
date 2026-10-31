import {
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import { history } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { AgentOpsController } from './agent-ops-controller';
import {
  normalizeArtifactMarkdown,
  ROLE_LABELS,
  WORKFLOW_STATUS_LABELS,
} from './agent-ops-shared';
import type {
  IntentRoutingSummary,
  ProductionRole,
  ProductionWorkflow,
} from './service';

export function renderWorkflowPanel(controller: AgentOpsController) {
  const {
    workflowForm,
    workflow,
    productionWorkflows,
    workflowListLoading,
    runSummary,
    ragQuality,
    intentRouting,
    securityPolicies,
    securityAudit,
    loading,
    governancePlugins,
    pluginPreview,
    loadRunSummary,
    loadRagQuality,
    loadIntentRouting,
    loadSecurityPolicies,
    loadSecurityAudit,
    loadProductionWorkflows,
    handlePreviewPluginComposition,
    handleStartWorkflow,
    handleResume,
  } = controller;
  const workflowPanel = (
    <section className="agent-ops-panel">
      <Card
        title="Agent 运行质量汇总"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void loadRunSummary()}
          >
            刷新
          </Button>
        }
      >
        {runSummary ? (
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
            <Descriptions.Item label="成功率">
              {(runSummary.successRate * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="失败率">
              {(runSummary.failureRate * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="成本">
              ${runSummary.totalCostUsd.toFixed(4)}
            </Descriptions.Item>
            <Descriptions.Item label="工具调用">
              {runSummary.totalToolCalls}
            </Descriptions.Item>
            <Descriptions.Item label="扫描运行">
              {runSummary.scanned}
            </Descriptions.Item>
            <Descriptions.Item label="重试次数">
              {runSummary.totalRetries}
            </Descriptions.Item>
            <Descriptions.Item label="需审批／预算超限">
              {runSummary.budgetExceededRuns}
            </Descriptions.Item>
            <Descriptions.Item label="步骤准确率">
              {((runSummary.stepAccuracy ?? 0) * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="恢复成功率">
              {((runSummary.recoveryRate ?? 0) * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="运行成功率">
              {(
                (runSummary.qualityLayers?.runSuccessRate ??
                  runSummary.successRate) * 100
              ).toFixed(1)}
              %
            </Descriptions.Item>
            <Descriptions.Item label="工具成功率">
              {((runSummary.qualityLayers?.toolSuccessRate ?? 0) * 100).toFixed(
                1,
              )}
              %
            </Descriptions.Item>
            <Descriptions.Item label="任务正确率">
              {(
                (runSummary.qualityLayers?.taskAccuracy ??
                  runSummary.stepAccuracy ??
                  0) * 100
              ).toFixed(1)}
              %
            </Descriptions.Item>
            <Descriptions.Item label="交付可用率">
              {(
                (runSummary.qualityLayers?.deliveryReadyRate ?? 0) * 100
              ).toFixed(1)}
              %
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Alert type="info" showIcon title="暂无运行汇总数据" />
        )}
      </Card>
      <Card
        title="RAG 质量门禁"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void loadRagQuality()}
          >
            刷新
          </Button>
        }
      >
        {ragQuality ? (
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
            <Descriptions.Item label="回答率">
              {(ragQuality.answerRate * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="引用率">
              {(ragQuality.citationRate * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="拒答率">
              {(ragQuality.refusalRate * 100).toFixed(1)}%
            </Descriptions.Item>
            <Descriptions.Item label="平均延迟">
              {Math.round(ragQuality.averageLatencyMs)} ms
            </Descriptions.Item>
            <Descriptions.Item label="发布判定">
              <Tag color={ragQuality.gate?.passed ? 'green' : 'red'}>
                {ragQuality.gate?.passed ? '通过' : '不通过'}
              </Tag>
            </Descriptions.Item>
            {!ragQuality.gate?.passed && (
              <Descriptions.Item label="失败原因" span={3}>
                {ragQuality.gate?.reasons?.join('；') || '暂无'}
              </Descriptions.Item>
            )}
          </Descriptions>
        ) : (
          <Alert type="info" showIcon title="暂无 RAG 质量汇总数据" />
        )}
      </Card>
      <Card
        title="查询路由记录"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void loadIntentRouting()}
          >
            刷新
          </Button>
        }
      >
        {intentRouting ? (
          <>
            <Alert
              type={intentRouting.estimated ? 'warning' : 'info'}
              showIcon
              style={{ marginBottom: 12 }}
              title={intentRouting.note ?? '路由统计已加载'}
            />
            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
              <Descriptions.Item label="扫描问答">
                {intentRouting.scanned}
              </Descriptions.Item>
              <Descriptions.Item label="进入检索">
                {intentRouting.byAction.retrieve ?? 0}
              </Descriptions.Item>
              <Descriptions.Item label="直接回答">
                {intentRouting.byAction.direct_answer ?? 0}
              </Descriptions.Item>
              <Descriptions.Item label="未记录路由">
                {intentRouting.byAction.unknown ?? 0}
              </Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              style={{ marginTop: 12 }}
              rowKey="id"
              pagination={{ pageSize: 6 }}
              dataSource={intentRouting.recent}
              columns={[
                { title: '问题', dataIndex: 'query', ellipsis: true },
                {
                  title: '动作',
                  dataIndex: 'action',
                  render: (value: string) => (
                    <Tag
                      color={
                        value === 'retrieve'
                          ? 'blue'
                          : value === 'direct_answer'
                            ? 'green'
                            : 'default'
                      }
                    >
                      {value === 'retrieve'
                        ? '检索'
                        : value === 'direct_answer'
                          ? '直答'
                          : '未记录'}
                    </Tag>
                  ),
                },
                { title: '类型', dataIndex: 'queryType' },
                { title: '模式', dataIndex: 'mode' },
                {
                  title: '证据',
                  render: (
                    _: unknown,
                    row: IntentRoutingSummary['recent'][number],
                  ) =>
                    row.cited ? (
                      <Tag color="green">有引用</Tag>
                    ) : (
                      <Tag>无引用</Tag>
                    ),
                },
                {
                  title: '时间',
                  dataIndex: 'createdAt',
                  render: (value: string) =>
                    value ? new Date(value).toLocaleString('zh-CN') : '-',
                },
              ]}
            />
          </>
        ) : (
          <Alert type="info" showIcon title="暂无意图路由数据" />
        )}
      </Card>
      <Card
        title={`RAG 安全策略（审计事件 ${securityAudit.length}）`}
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() =>
              void Promise.all([loadSecurityPolicies(), loadSecurityAudit()])
            }
          >
            刷新
          </Button>
        }
      >
        <Space wrap>
          {securityPolicies.map((policy) => (
            <Tag
              key={policy.id ?? policy.name}
              color={policy.severity === 'high' ? 'red' : 'orange'}
            >
              {policy.name ?? policy.id}
            </Tag>
          ))}
          {!securityPolicies.length && (
            <Typography.Text type="secondary">
              暂无策略或服务未连接
            </Typography.Text>
          )}
        </Space>
        <Table
          size="small"
          style={{ marginTop: 12 }}
          rowKey={(row) => row.id ?? `${row.createdAt}-${row.eventType}`}
          dataSource={securityAudit}
          pagination={{ pageSize: 5 }}
          locale={{ emptyText: '暂无拦截事件' }}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              render: (value: string) =>
                value ? new Date(value).toLocaleString() : '-',
            },
            {
              title: '策略',
              render: (_: unknown, row: any) => row.payload?.pattern ?? '-',
            },
            {
              title: '路由',
              render: (_: unknown, row: any) => row.payload?.route ?? '-',
            },
            {
              title: '用户',
              render: (_: unknown, row: any) => row.payload?.userId ?? '-',
            },
            {
              title: '查询摘要',
              render: (_: unknown, row: any) =>
                row.payload?.queryHash
                  ? `${String(row.payload.queryHash).slice(0, 12)}…`
                  : '已脱敏',
            },
          ]}
        />
      </Card>
      <Card
        title="产研运工作流列表"
        size="small"
        extra={
          <Button
            icon={<ReloadOutlined />}
            loading={workflowListLoading}
            onClick={() => void loadProductionWorkflows()}
          >
            刷新
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <Table
          size="small"
          rowKey="threadId"
          loading={workflowListLoading}
          dataSource={productionWorkflows}
          pagination={{ pageSize: 5 }}
          onRow={(record) => ({
            onClick: () => {
              history.push(
                `/agent-ops/workflows/${encodeURIComponent(record.threadId)}`,
              );
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            { title: '项目／活动', dataIndex: 'projectId' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value: ProductionWorkflow['status']) => (
                <Tag
                  color={
                    value === 'completed'
                      ? 'green'
                      : value === 'failed'
                        ? 'red'
                        : value === 'pending_approval' ||
                            value === 'revision_required'
                          ? 'orange'
                          : 'blue'
                  }
                >
                  {WORKFLOW_STATUS_LABELS[value] ?? value}
                </Tag>
              ),
            },
            {
              title: '完成岗位',
              render: (_, record) =>
                `${record.completedRoles?.length ?? 0}/${record.selectedRoles?.length ?? 0}`,
            },
            {
              title: '当前批次',
              render: (_, record) =>
                record.currentBatch
                  ?.map((role: ProductionRole) => ROLE_LABELS[role])
                  .join('＋') || '已完成',
            },
            { title: 'Thread', dataIndex: 'threadId', ellipsis: true },
          ]}
        />
        <div style={{ color: '#667085', marginTop: 8 }}>
          点击任意工作流查看详情、阶段产物和审批操作。
        </div>
      </Card>
      <Form form={workflowForm} layout="vertical">
        <div className="agent-ops-form-grid">
          <Form.Item
            label="项目／活动 ID"
            name="projectId"
            rules={[{ required: true }]}
          >
            <Input placeholder="anniversary-2026" />
          </Form.Item>
          <Form.Item label="最大步骤" name="maxSteps" initialValue={18}>
            <InputNumber min={6} max={30} />
          </Form.Item>
          <Form.Item label="审批策略" name="approvalMode" initialValue="auto">
            <Select
              options={[
                { value: 'auto', label: '普通任务：自动流转' },
                { value: 'risk_based', label: '按风险审批' },
                { value: 'required', label: '全部岗位人工审批' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="协作策略"
            name="processType"
            initialValue="sequential"
          >
            <Select
              options={[
                { value: 'sequential', label: 'Sequential：按依赖顺序' },
                { value: 'hierarchical', label: 'Hierarchical：Manager 委派' },
                { value: 'conditional', label: 'Conditional：按质量分支' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="插件能力包"
            name="pluginKeys"
            initialValue={['workflow.production-base']}
          >
            <Select
              mode="multiple"
              placeholder="选择并组合能力包"
              options={governancePlugins
                .filter(
                  (plugin) =>
                    plugin.status === 'enabled' &&
                    (plugin.modes ?? []).includes('production'),
                )
                .map((plugin) => ({
                  value: plugin.key,
                  label: `${plugin.displayName ?? plugin.key}（${plugin.key}）`,
                }))}
            />
          </Form.Item>
          <Form.Item label="组合校验">
            <Button onClick={() => void handlePreviewPluginComposition()}>
              预览有效工具
            </Button>
          </Form.Item>
        </div>
        {pluginPreview && (
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 16 }}
            title={`已组合：${(pluginPreview.pluginKeys ?? []).join('、') || '无'}`}
            description={`有效工具：${(pluginPreview.toolNames ?? []).join('、') || '无（将只保留模型生成，不调用工具）'}`}
          />
        )}
        <Form.Item
          label="参与岗位"
          name="roles"
          initialValue={Object.keys(ROLE_LABELS)}
          rules={[{ required: true, message: '至少选择一个岗位' }]}
        >
          <Select
            mode="multiple"
            options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
            placeholder="选择独立执行或协作执行的岗位"
          />
        </Form.Item>
        <div className="agent-ops-form-grid">
          <Form.Item
            label="指定审批岗位"
            name="approvalRoles"
            initialValue={[]}
          >
            <Select
              allowClear
              mode="multiple"
              options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              placeholder="无论风险级别都需要审批"
            />
          </Form.Item>
          <Form.Item
            label="风险审批阈值"
            name="riskApprovalThreshold"
            initialValue="high"
          >
            <Select
              options={[
                { value: 'high', label: '仅高风险' },
                { value: 'medium', label: '中、高风险' },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item
          label="需求背景"
          name="brief"
          rules={[{ required: true, min: 10 }]}
        >
          <Input.TextArea
            rows={5}
            placeholder="活动目标、范围、规则、地区版本和上线约束"
          />
        </Form.Item>
        <Button
          loading={loading}
          onClick={() => void handleStartWorkflow()}
          type="primary"
        >
          启动工作流
        </Button>
        {history.location.pathname.includes('/workflows/') && workflow && (
          <div className="agent-workflow-result">
            <Steps
              current={workflow.stageIndex}
              items={workflow.selectedRoles.map((key, index) => ({
                title: ROLE_LABELS[key],
                status:
                  workflow.status === 'failed' && index === workflow.stageIndex
                    ? 'error'
                    : workflow.completedRoles.includes(key)
                      ? 'finish'
                      : workflow.currentBatch.includes(key)
                        ? 'process'
                        : 'wait',
              }))}
            />
            <Descriptions
              column={3}
              items={[
                {
                  key: 'status',
                  label: '状态',
                  children: WORKFLOW_STATUS_LABELS[workflow.status],
                },
                {
                  key: 'steps',
                  label: '步数',
                  children: `${workflow.stepCount}/${workflow.maxSteps}`,
                },
                {
                  key: 'approvalMode',
                  label: '审批策略',
                  children:
                    workflow.approvalMode === 'required'
                      ? '全部岗位人工审批'
                      : workflow.approvalMode === 'risk_based'
                        ? `${workflow.riskApprovalThreshold === 'high' ? '高' : '中、高'}风险审批`
                        : '普通任务自动流转',
                },
                { key: 'thread', label: 'Thread', children: workflow.threadId },
                {
                  key: 'batch',
                  label: '当前批次',
                  children:
                    workflow.currentBatch
                      .map((role) => ROLE_LABELS[role])
                      .join('＋') || '已完成',
                },
              ]}
            />
            <Collapse
              items={workflow.selectedRoles
                .filter((role) => workflow.results[role])
                .map((role) => {
                  const result = workflow.results[role];
                  if (!result) return null;
                  const pendingClaims = result.claims.filter(
                    (claim) => claim.status === 'pending_confirmation',
                  );
                  return {
                    key: role,
                    label: (
                      <span>
                        {ROLE_LABELS[role]}：{result.summary}{' '}
                        <Tag
                          color={
                            result.riskLevel === 'high'
                              ? 'red'
                              : result.riskLevel === 'medium'
                                ? 'orange'
                                : 'green'
                          }
                        >
                          {result.riskLevel === 'high'
                            ? '高风险'
                            : result.riskLevel === 'medium'
                              ? '中风险'
                              : '低风险'}
                        </Tag>
                        <Tag
                          color={
                            result.evidenceCoverage === 1 ? 'green' : 'orange'
                          }
                        >
                          证据覆盖 {Math.round(result.evidenceCoverage * 100)}%
                        </Tag>
                      </span>
                    ),
                    children: (
                      <div className="agent-stage-output">
                        {pendingClaims.length > 0 && (
                          <Alert
                            showIcon
                            title={`${pendingClaims.length} 条事实声明缺少有效证据，需人工确认`}
                            type="warning"
                          />
                        )}
                        {result.deliverables.map((deliverable) => (
                          <section
                            key={`${deliverable.type}-${deliverable.title}`}
                          >
                            <strong>{deliverable.title}</strong>
                            <XMarkdown
                              className="agent-deliverable-markdown"
                              content={normalizeArtifactMarkdown(
                                deliverable.markdown,
                              )}
                              escapeRawHtml
                              openLinksInNewTab
                              paragraphTag="div"
                            />
                          </section>
                        ))}
                        <p>问题：{result.issues.join('；') || '无'}</p>
                        <p>
                          下游风险：{result.downstreamRisks.join('；') || '无'}
                        </p>
                        <p>
                          工具：
                          {result.toolExecutions
                            .map(
                              (tool) =>
                                `${tool.tool}（${tool.status}，${tool.durationMs}ms）`,
                            )
                            .join('；') || '无'}
                        </p>
                        {result.generatedArtifact && (
                          <p>
                            产物任务：{result.generatedArtifact.title}（
                            {result.generatedArtifact.status}，ID：
                            {result.generatedArtifact.id}）
                          </p>
                        )}
                      </div>
                    ),
                  };
                })
                .filter(
                  (item): item is NonNullable<typeof item> => item !== null,
                )}
            />
            {workflow.requiresApproval && (
              <div className="agent-approval-row">
                <Form.Item name="feedback" noStyle>
                  <Input placeholder="驳回时填写修改意见" />
                </Form.Item>
                <Form.Item name="rerunRoles" noStyle>
                  <Select
                    mode="multiple"
                    options={workflow.currentBatch.map((role) => ({
                      value: role,
                      label: ROLE_LABELS[role],
                    }))}
                    placeholder="选择需要重跑的岗位"
                  />
                </Form.Item>
                <Button
                  icon={<CheckOutlined />}
                  loading={loading}
                  onClick={() => void handleResume('approved')}
                  type="primary"
                >
                  批准并继续
                </Button>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  loading={loading}
                  onClick={() => void handleResume('rejected')}
                >
                  驳回并重新处理
                </Button>
              </div>
            )}
          </div>
        )}
      </Form>
    </section>
  );

  return { workflowPanel };
}
