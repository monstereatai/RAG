import { ReloadOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { agentOpsNav, ModulePage } from '@/components/AdminShell';
import type { AgentOpsController } from './agent-ops-controller';
import { renderAgentOpsPanels } from './agent-ops-panels';
import { ARTIFACT_LABELS } from './agent-ops-shared';
import { ScheduledAnalysisPanel } from './scheduled-analysis-panel';
import {
  type AgenticRunSnapshot,
  type AgentBadCase,
  getAgentRunArtifacts,
  unwrapData,
} from './service';

export function AgentOpsView(controller: AgentOpsController) {
  const {
    reviewForm,
    badCases,
    traces,
    runSnapshot,
    setRunSnapshot,
    runOptions,
    runCenter,
    artifactThreadId,
    setArtifactThreadId,
    artifactLoading,
    runOptionsLoading,
    selectedBadCase,
    setSelectedBadCase,
    loading,
    loadBadCases,
    loadTraces,
    loadRunOptions,
    loadRunArtifacts,
    handleRetryRun,
    handleReview,
  } = controller;
  const {
    workflowPanel,
    evalPanel,
    governancePanel,
    runCenterPanel,
    collaborationPanel,
  } = renderAgentOpsPanels(controller);
  return (
    <ModulePage
      activeKey={
        history.location.pathname.endsWith('/bad-cases')
          ? 'bad-cases'
          : history.location.pathname.endsWith('/schedules')
            ? 'schedules'
            : history.location.pathname.endsWith('/run-center')
              ? 'run-center'
              : history.location.pathname.endsWith('/collaboration')
                ? 'collaboration'
                : history.location.pathname.endsWith('/evals')
                  ? 'evals'
                  : history.location.pathname.endsWith('/traces')
                    ? 'traces'
                    : history.location.pathname.endsWith('/artifacts')
                      ? 'artifacts'
                      : history.location.pathname.endsWith('/governance')
                        ? 'governance'
                        : 'workspace'
      }
      navItems={agentOpsNav}
      title="Agent 运营"
    >
      <div className="agent-ops-page">
        <header>
          <h2>Agent 运行与质量控制</h2>
          <p>审批长流程、回灌已审核 Bad Case、执行单案例评测并查看调用轨迹。</p>
        </header>
        <Tabs
          activeKey={
            history.location.pathname.endsWith('/bad-cases')
              ? 'bad-cases'
              : history.location.pathname.endsWith('/schedules')
                ? 'schedules'
                : history.location.pathname.endsWith('/run-center')
                  ? 'run-center'
                  : history.location.pathname.endsWith('/collaboration')
                    ? 'collaboration'
                    : history.location.pathname.endsWith('/evals')
                      ? 'evals'
                      : history.location.pathname.endsWith('/traces')
                        ? 'traces'
                        : history.location.pathname.endsWith('/artifacts')
                          ? 'artifacts'
                          : history.location.pathname.endsWith('/governance')
                            ? 'governance'
                            : 'workflow'
          }
          onChange={(key) => {
            const routes: Record<string, string> = {
              workflow: '/agent-ops',
              evals: '/agent-ops/evals',
              'bad-cases': '/agent-ops/bad-cases',
              schedules: '/agent-ops/schedules',
              'run-center': '/agent-ops/run-center',
              collaboration: '/agent-ops/collaboration',
              traces: '/agent-ops/traces',
              artifacts: '/agent-ops/artifacts',
              governance: '/agent-ops/governance',
            };
            history.push(routes[key] ?? '/agent-ops');
          }}
          items={[
            { key: 'workflow', label: '产研运工作流', children: workflowPanel },
            {
              key: 'schedules',
              label: '定时任务',
              children: <ScheduledAnalysisPanel />,
            },
            { key: 'run-center', label: '运行中心', children: runCenterPanel },
            {
              key: 'collaboration',
              label: '协作编排',
              children: collaborationPanel,
            },
            { key: 'evals', label: 'Agent Evals', children: evalPanel },
            { key: 'governance', label: '平台治理', children: governancePanel },
            {
              key: 'bad-cases',
              label: `Bad Case（${badCases.length}）`,
              children: (
                <section className="agent-ops-panel">
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => void loadBadCases()}
                  >
                    刷新
                  </Button>
                  <Table
                    dataSource={badCases}
                    rowKey="id"
                    pagination={{ pageSize: 8 }}
                    columns={[
                      { title: '问题', dataIndex: 'query', ellipsis: true },
                      {
                        title: '错误类型',
                        dataIndex: 'errorType',
                        render: (value) => value || '-',
                      },
                      {
                        title: '关联 Skill',
                        dataIndex: 'skills',
                        render: (skills: AgentBadCase['skills']) =>
                          skills?.length
                            ? skills.map((skill) => (
                                <Tag key={`${skill.name}:${skill.version ?? 'unknown'}`}>
                                  {skill.name}
                                </Tag>
                              ))
                            : '-',
                      },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      {
                        title: '回归集',
                        dataIndex: 'includeInRegression',
                        render: (value) => (
                          <Tag color={value ? 'green' : 'default'}>
                            {value ? '已加入' : '未加入'}
                          </Tag>
                        ),
                      },
                      {
                        title: '知识层',
                        dataIndex: 'knowledgeLayer',
                        render: (value) => (
                          <Tag
                            color={
                              value === 'formal'
                                ? 'blue'
                                : value === 'correction'
                                  ? 'orange'
                                  : 'default'
                            }
                          >
                            {value === 'formal'
                              ? '正式知识'
                              : value === 'correction'
                                ? '纠正层'
                                : '未生效'}
                          </Tag>
                        ),
                      },
                      {
                        title: '晋升状态',
                        dataIndex: 'promotionStatus',
                        render: (value, record) => (
                          <span>
                            {value === 'promoted'
                              ? `已晋升${record.promotedDocId ? ` · ${record.promotedDocId.slice(0, 8)}` : ''}`
                              : value === 'pending'
                                ? '待晋升'
                                : value === 'rejected'
                                  ? '已拒绝'
                                  : '未申请'}
                          </span>
                        ),
                      },
                      {
                        title: '纠正答案',
                        dataIndex: 'correctedAnswer',
                        ellipsis: true,
                        render: (value) => value || '-',
                      },
                      {
                        title: '操作',
                        render: (_, record) => (
                          <Button
                            size="small"
                            disabled={record.knowledgeLayer === 'formal'}
                            title={
                              record.knowledgeLayer === 'formal'
                                ? '已晋升内容请到文档管理中进行版本治理'
                                : undefined
                            }
                            onClick={() => {
                              setSelectedBadCase(record);
                              reviewForm.setFieldsValue({
                                status: 'reviewed',
                                correctedAnswer: record.correctedAnswer,
                                includeInRegression: true,
                                promotionAction: 'correction',
                                promotionSource: record.promotionSource,
                              });
                            }}
                          >
                            {record.knowledgeLayer === 'formal'
                              ? '已晋升'
                              : '审核'}
                          </Button>
                        ),
                      },
                    ]}
                  />
                </section>
              ),
            },
            {
              key: 'traces',
              label: '调用轨迹',
              children: (
                <section className="agent-ops-panel">
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => void loadTraces()}
                  >
                    刷新
                  </Button>
                  <Table
                    dataSource={traces}
                    rowKey="spanId"
                    pagination={{ pageSize: 10 }}
                    columns={[
                      {
                        title: 'Trace ID',
                        dataIndex: 'traceId',
                        ellipsis: true,
                      },
                      { title: '方法', dataIndex: 'method', width: 90 },
                      { title: '路由', dataIndex: 'route', ellipsis: true },
                      { title: '状态', dataIndex: 'status', width: 90 },
                      {
                        title: '耗时',
                        dataIndex: 'durationMs',
                        width: 110,
                        render: (value) => `${value} ms`,
                      },
                      {
                        title: '开始时间',
                        dataIndex: 'startedAt',
                        render: (value) =>
                          new Date(value).toLocaleString('zh-CN'),
                      },
                    ]}
                  />
                </section>
              ),
            },
            {
              key: 'artifacts',
              label: 'Artifact 审计',
              children: (
                <section className="agent-ops-panel">
                  <Alert
                    showIcon
                    type="info"
                    title="查看一次 Agentic 运行在 Redis Checkpointer 中保存的结构化交接物"
                    description="页面会自动选择最近会话；优先使用下拉选择，手动输入 Thread ID 仅用于高级排障。"
                  />
                  <div className="agent-ops-form-grid">
                    <Select
                      allowClear
                      loading={runOptionsLoading}
                      value={
                        runOptions.some(
                          (item) => item.threadId === artifactThreadId,
                        )
                          ? artifactThreadId
                          : undefined
                      }
                      onChange={(value) => {
                        setArtifactThreadId(value ?? '');
                        if (value) {
                          void getAgentRunArtifacts(value).then((result) =>
                            setRunSnapshot(
                              unwrapData<AgenticRunSnapshot>(result),
                            ),
                          );
                        } else {
                          setRunSnapshot(null);
                        }
                      }}
                      showSearch={{ optionFilterProp: 'label' }}
                      options={runOptions.map((item) => ({
                        value: item.threadId,
                        label: `${item.title} · ${item.mode} · ${new Date(item.updatedAt).toLocaleString('zh-CN')}${item.checkpointAvailable ? ' · 已保存 Checkpoint' : ' · 无 Checkpoint'}`,
                      }))}
                      placeholder="选择最近 Agentic 会话"
                    />
                    <Button
                      icon={<ReloadOutlined />}
                      loading={runOptionsLoading}
                      onClick={() => void loadRunOptions()}
                    >
                      刷新会话列表
                    </Button>
                    <Input
                      value={artifactThreadId}
                      onChange={(event) =>
                        setArtifactThreadId(event.target.value)
                      }
                      onPressEnter={() => void loadRunArtifacts()}
                      placeholder="例如：ad8543e1-14ef-420c-a184-57595d6d01bc"
                    />
                    <Button
                      icon={<ReloadOutlined />}
                      loading={artifactLoading}
                      onClick={() => void loadRunArtifacts()}
                      type="primary"
                    >
                      查询运行状态
                    </Button>
                  </div>
                  {!runOptionsLoading && runOptions.length === 0 && (
                    <Alert
                      showIcon
                      type="warning"
                      title="暂时没有可审计的 Agentic 会话"
                      description="请先在 AI 智能问答中选择 Agentic 模式完成一次提问，再点击“刷新会话列表”。如果仍为空，请检查当前登录状态和 Agent Backend 服务。"
                    />
                  )}
                  {runSnapshot && (
                    <div className="agent-artifact-audit">
                      {!runSnapshot.available ? (
                        <Alert
                          showIcon
                          type={
                            runSnapshot.artifacts.length > 0
                              ? 'info'
                              : 'warning'
                          }
                          title={
                            runSnapshot.artifacts.length > 0
                              ? 'Checkpoint 已过期，已加载持久化交接物'
                              : '未找到该 Thread 的 Checkpoint'
                          }
                          description={
                            runSnapshot.artifacts.length > 0
                              ? 'Redis Checkpoint 可能已过 TTL，以下内容来自 PostgreSQL 持久化记录，仍可用于审计和交接。'
                              : '可能已过 Redis TTL，或该会话尚未进入 Agentic LangGraph 流程。'
                          }
                        />
                      ) : (
                        <>
                          <Descriptions
                            column={2}
                            items={[
                              {
                                key: 'thread',
                                label: 'Thread',
                                children: runSnapshot.threadId,
                              },
                              {
                                key: 'checkpoint',
                                label: 'Checkpoint',
                                children: runSnapshot.checkpointId,
                              },
                              {
                                key: 'route',
                                label: '路由',
                                children: runSnapshot.route ?? '-',
                              },
                              {
                                key: 'sufficient',
                                label: '检索充分',
                                children:
                                  runSnapshot.retrievalSufficient === null
                                    ? '-'
                                    : runSnapshot.retrievalSufficient
                                      ? '是'
                                      : '否',
                              },
                              {
                                key: 'retry',
                                label: '重试次数',
                                children: runSnapshot.retryCount ?? '-',
                              },
                              {
                                key: 'passed',
                                label: '契约通过',
                                children:
                                  runSnapshot.passed === null
                                    ? '-'
                                    : runSnapshot.passed
                                      ? '是'
                                      : '否',
                              },
                            ]}
                          />
                          <Button
                            loading={artifactLoading}
                            disabled={
                              !runCenter.some(
                                (run) =>
                                  run.threadId === runSnapshot.threadId &&
                                  ['failed', 'cancelled'].includes(
                                    run.status,
                                  ) &&
                                  ['auto', 'agentic'].includes(run.mode) &&
                                  run.route !== 'simple' &&
                                  run.route !== 'production_workflow',
                              )
                            }
                            onClick={() => void handleRetryRun()}
                            style={{ marginBottom: 16 }}
                          >
                            重新执行 Agentic 链路
                          </Button>
                          {runSnapshot.retrievalReason && (
                            <Alert
                              type="warning"
                              showIcon
                              title="检索结论"
                              description={runSnapshot.retrievalReason}
                            />
                          )}
                          <h3>子问题计划与证据状态</h3>
                          <Table
                            rowKey={(record, index) =>
                              String(record.id ?? index)
                            }
                            pagination={false}
                            dataSource={runSnapshot.subQuestions}
                            columns={[
                              {
                                title: '子问题',
                                dataIndex: 'question',
                                ellipsis: true,
                              },
                              {
                                title: '状态',
                                dataIndex: 'status',
                                render: (value) => (
                                  <Tag>{String(value ?? '-')}</Tag>
                                ),
                              },
                              {
                                title: '证据数',
                                dataIndex: 'evidenceIds',
                                render: (value) =>
                                  Array.isArray(value) ? value.length : 0,
                              },
                              {
                                title: '检索次数',
                                dataIndex: 'retrievalAttempts',
                              },
                            ]}
                          />
                        </>
                      )}
                      {runSnapshot.artifacts.length > 0 && (
                        <>
                          <h3>Artifact 交接物</h3>
                          <Collapse
                            items={runSnapshot.artifacts.map((artifact) => ({
                              key: artifact.id,
                              label: `${ARTIFACT_LABELS[artifact.type] ?? artifact.type} · ${artifact.producer} · ${new Date(artifact.createdAt).toLocaleString('zh-CN')}`,
                              children: (
                                <pre>
                                  {JSON.stringify(artifact.payload, null, 2)}
                                </pre>
                              ),
                            }))}
                          />
                        </>
                      )}
                    </div>
                  )}
                </section>
              ),
            },
          ]}
        />
      </div>
      <Modal
        open={Boolean(selectedBadCase)}
        title="审核 Bad Case"
        okText="保存并回灌"
        confirmLoading={loading}
        onCancel={() => setSelectedBadCase(null)}
        onOk={() => void handleReview()}
      >
        <Form form={reviewForm} layout="vertical">
          {selectedBadCase?.skills?.length ? (
            <Form.Item label="关联 Skill 版本">
              <div>
                {selectedBadCase.skills.map((skill) => (
                  <Tag key={`${skill.name}:${skill.version ?? 'unknown'}`} title={skill.version}>
                    {skill.name}@{skill.version?.slice(0, 12) ?? '旧运行未记录版本'} · {skill.injected ? '已注入' : '未注入'}
                  </Tag>
                ))}
              </div>
            </Form.Item>
          ) : (
            <Alert
              type="info"
              showIcon
              title="本次运行未记录关联 Skill 版本"
              description="历史运行或未选中 Skill 的回答无法关联到具体 Skill。"
              style={{ marginBottom: 16 }}
            />
          )}
          <Alert
            type="info"
            showIcon
            title="Skill 修改需要人工审核"
            description="依据关联版本在 Git 中审查并修改 SKILL.md；将本案例加入回归集后，再用 Agent Evals 验证改动。失败轨迹不会自动改写 Skill。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            label="审核状态"
            name="status"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'reviewed', label: '审核通过' },
                { value: 'resolved', label: '已解决' },
                { value: 'ignored', label: '忽略' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="知识处理方式"
            name="promotionAction"
            initialValue="correction"
          >
            <Select
              options={[
                {
                  value: 'correction',
                  label: '保留在纠正知识层（默认，可撤销）',
                },
                { value: 'request', label: '标记待晋升（暂不写入正式知识）' },
                { value: 'promote', label: '晋升正式知识（需已核验来源）' },
                { value: 'reject', label: '拒绝晋升申请' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="正式来源／规范地址"
            name="promotionSource"
            dependencies={['promotionAction']}
            extra="仅在“晋升正式知识”时必填。来源会写入新正式文档，不能用用户修正答案替代来源。"
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (
                    getFieldValue('promotionAction') !== 'promote' ||
                    value?.trim()
                  )
                    return Promise.resolve();
                  return Promise.reject(
                    new Error('晋升正式知识必须填写已核验来源或规范文档地址'),
                  );
                },
              }),
            ]}
          >
            <Input placeholder="https://… 或内部规范文档 ID" />
          </Form.Item>
          <Form.Item
            label="正式知识版本（可选）"
            name="promotionVersion"
            extra="不填时系统按 Bad Case 编号生成版本号。"
          >
            <Input placeholder="例如 2026-08-v2" />
          </Form.Item>
          <Form.Item
            label="纠正答案"
            name="correctedAnswer"
            dependencies={['status']}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (getFieldValue('status') === 'ignored' || value?.trim()) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error('审核通过或解决时必须填写纠正答案'),
                  );
                },
              }),
            ]}
          >
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item
            label="进入回归集"
            name="includeInRegression"
            valuePropName="checked"
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
        </Form>
      </Modal>
    </ModulePage>
  );
}
