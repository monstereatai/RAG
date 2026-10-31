import { ExperimentOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import type { AgentOpsController } from './agent-ops-controller';
import {
  METRIC_LABELS,
  parseRetrievalConfig,
  retrievalDebugCard,
} from './agent-ops-shared';

export function renderEvalPanelAndGovernancePanel(
  controller: AgentOpsController,
) {
  const {
    evalForm,
    knowledgeBaseForm,
    pluginForm,
    evalResult,
    loading,
    governanceModels,
    governancePlugins,
    governanceWorkflows,
    evaluationCases,
    knowledgeBaseProfiles,
    retrievalQuery,
    setRetrievalQuery,
    retrievalProfileKey,
    setRetrievalProfileKey,
    retrievalCompareProfileKey,
    setRetrievalCompareProfileKey,
    retrievalDebugVariants,
    retrievalDebugLoading,
    governanceLoading,
    loadGovernance,
    handleCloneWorkflow,
    handleRegisterKnowledgeBase,
    handleCloneKnowledgeBaseProfile,
    handleRunRetrievalDebug,
    handleRegisterPlugin,
    handleTogglePlugin,
    handleEval,
  } = controller;
  const evalStatus: {
    title: string;
    type: 'success' | 'info' | 'warning' | 'error';
  } | null = evalResult
    ? evalResult.status === 'evaluated'
      ? {
          title: evalResult.passed ? '评测通过' : '评测未通过',
          type: evalResult.passed ? 'success' : 'error',
        }
      : evalResult.status === 'insufficient_data'
        ? { title: '资料不足，未评测', type: 'warning' }
        : { title: '未评测', type: 'info' }
    : null;

  const evalIssues = evalResult
    ? [
        {
          label: '无证据支持的事实',
          items: evalResult.assertions.unsupportedClaims,
        },
        {
          label: '未覆盖的答案要求',
          items: evalResult.assertions.missingRequirements,
        },
        {
          label: '未命中的检索证据',
          items: evalResult.assertions.missingContextClaims,
        },
        {
          label: '缺少的用例结构',
          items: evalResult.assertions.missingTestCaseSections,
        },
      ]
    : [];

  const evalPanel = (
    <section className="agent-ops-panel">
      <Alert
        showIcon
        type="info"
        title="单条样例评测"
        description="手工提供问题、检索证据、标准要求和应命中的证据；这不读取 Agent 运行轨迹，也不统计步骤或工具成功率。"
        style={{ marginBottom: 16 }}
      />
      <Form form={evalForm} layout="vertical">
        <Form.Item label="评测问题" name="query" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item
          label="检索证据（每行一段）"
          name="contexts"
          rules={[{ required: true }]}
        >
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item
          label="Agent 输出"
          name="output"
          rules={[{ required: true }]}
        >
          <Input.TextArea rows={6} />
        </Form.Item>
        <Form.Item dependencies={['useJudge']} noStyle>
          {({ getFieldValue }) => (
            <Form.Item
              label="答案必须覆盖的标准要求（每行一条）"
              name="requiredClaims"
              rules={
                getFieldValue('useJudge')
                  ? [{ required: true, message: '请填写至少一条答案要求' }]
                  : []
              }
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
        </Form.Item>
        <Form.Item dependencies={['useJudge']} noStyle>
          {({ getFieldValue }) => (
            <Form.Item
              label="检索证据应包含的标准内容（每行一条）"
              name="expectedContextClaims"
              rules={
                getFieldValue('useJudge')
                  ? [{ required: true, message: '请填写至少一条应命中的证据' }]
                  : []
              }
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
        </Form.Item>
        <div className="agent-ops-form-grid">
          <Form.Item label="任务类型" name="taskType" initialValue="general">
            <Select
              options={[
                { value: 'general', label: '通用' },
                { value: 'prd', label: 'PRD' },
                { value: 'test_case', label: '测试用例' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="启用大模型裁判"
            name="useJudge"
            valuePropName="checked"
            initialValue={true}
            extra="关闭后只检查测试用例结构，不给回答质量打分。"
          >
            <Switch checkedChildren="启用" unCheckedChildren="关闭" />
          </Form.Item>
        </div>
        <Button
          icon={<ExperimentOutlined />}
          loading={loading}
          onClick={() => void handleEval()}
          type="primary"
        >
          运行评测
        </Button>
      </Form>
      {evalResult && (
        <div className="agent-eval-result">
          <Alert
            showIcon
            title={evalStatus?.title}
            type={evalStatus?.type}
            description={evalResult.reason}
          />
          <div className="agent-metric-grid">
            {Object.entries(evalResult.metrics)
              .filter(([, value]) => value !== null)
              .map(([key, value]) => (
                <div key={key}>
                  <span>{METRIC_LABELS[key] ?? key}</span>
                  <Progress
                    percent={Math.round((value ?? 0) * 100)}
                    size="small"
                    status={
                      (value ?? 0) >= (evalResult.thresholds[key] ?? 1)
                        ? 'success'
                        : 'exception'
                    }
                  />
                </div>
              ))}
          </div>
          {evalIssues.some(({ items }) => items.length > 0) && (
            <ul>
              {evalIssues.flatMap(({ label, items }) =>
                items.map((item) => (
                  <li key={`${label}:${item}`}>
                    {label}：{item}
                  </li>
                )),
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );

  const governancePanel = (
    <section className="agent-ops-panel">
      <Alert
        showIcon
        type="info"
        title="平台治理"
        description="管理当前项目的工作流版本、模型与工具能力，并用同一套检索链路定位召回、重排和引用问题。"
      />
      <Button
        icon={<ReloadOutlined />}
        loading={governanceLoading}
        onClick={() => void loadGovernance()}
        style={{ margin: '16px 0' }}
      >
        刷新治理数据
      </Button>
      <div className="agent-governance-grid">
        <Card title={`模型注册（${governanceModels.length}）`} size="small">
          <Table
            size="small"
            rowKey={(row) => row.id ?? `${row.provider}-${row.model}`}
            pagination={false}
            dataSource={governanceModels}
            columns={[
              { title: '提供方', dataIndex: 'provider' },
              { title: '模型', dataIndex: 'model' },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value) => <Tag>{value}</Tag>,
              },
              {
                title: '降级模型',
                dataIndex: 'fallbackModel',
                render: (value) => value || '-',
              },
            ]}
          />
        </Card>
        <Card
          className="agent-governance-plugin-card"
          title={`工具／插件注册（${governancePlugins.length}）`}
          size="small"
        >
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 12 }}
            description="插件是声明式能力包：只能组合已在 Tool Registry 注册的工具，不支持上传并执行任意代码。工作流启动时会把选中的插件和有效工具写入运行审计。"
          />
          <div className="agent-governance-table-wrap">
            <Table
              size="small"
              rowKey={(row) => row.id ?? row.key}
              pagination={false}
              scroll={{ x: 820 }}
              dataSource={governancePlugins}
              columns={[
                { title: '标识', dataIndex: 'key', width: 190 },
                { title: '类型', dataIndex: 'type', width: 100 },
                { title: '版本', dataIndex: 'version', width: 90 },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 90,
                  render: (value) => <Tag>{value}</Tag>,
                },
                {
                  title: '工具',
                  dataIndex: 'tools',
                  width: 360,
                  render: (value) => (
                    <span className="agent-governance-tools">
                      {(value ?? []).join('、') || '-'}
                    </span>
                  ),
                },
                {
                  title: '操作',
                  width: 90,
                  render: (_, row) => (
                    <Button
                      size="small"
                      disabled={row.builtin}
                      onClick={() => void handleTogglePlugin(row)}
                    >
                      {row.status === 'enabled' ? '停用' : '启用'}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
          <Form form={pluginForm} layout="vertical" style={{ marginTop: 16 }}>
            <div className="agent-ops-form-grid">
              <Form.Item
                label="插件 Key"
                name="key"
                rules={[
                  { required: true, message: '例如 workflow.partner-review' },
                ]}
              >
                <Input placeholder="workflow.partner-review" />
              </Form.Item>
              <Form.Item
                label="显示名称"
                name="displayName"
                rules={[{ required: true }]}
              >
                <Input placeholder="合作方审查能力包" />
              </Form.Item>
              <Form.Item label="类型" name="type" initialValue="tool">
                <Select
                  options={[
                    'tool',
                    'mcp',
                    'datasource',
                    'agent_strategy',
                    'trigger',
                  ].map((value) => ({ value, label: value }))}
                />
              </Form.Item>
              <Form.Item label="版本" name="version" initialValue="1.0.0">
                <Input />
              </Form.Item>
            </div>
            <Form.Item label="已注册工具（英文逗号分隔）" name="tools">
              <Input placeholder="product_knowledge_search, artifact_generate" />
            </Form.Item>
            <div className="agent-ops-form-grid">
              <Form.Item
                label="适用链路"
                name="modes"
                initialValue={['production']}
              >
                <Select
                  mode="multiple"
                  options={['simple', 'auto', 'agentic', 'production'].map(
                    (value) => ({ value, label: value }),
                  )}
                />
              </Form.Item>
              <Form.Item label="说明" name="description">
                <Input placeholder="该能力包解决什么问题" />
              </Form.Item>
            </div>
            <Button type="primary" onClick={() => void handleRegisterPlugin()}>
              登记插件
            </Button>
          </Form>
        </Card>
      </div>
      <Card title="工作流版本与回滚" size="small" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={governanceWorkflows}
          columns={[
            { title: '工作流', dataIndex: 'name' },
            { title: 'Key', dataIndex: 'key' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value) => <Tag>{value}</Tag>,
            },
            {
              title: '当前版本',
              dataIndex: 'activeVersion',
              render: (value) => value || '-',
            },
            {
              title: '操作',
              render: (_, record) => (
                <Button
                  size="small"
                  onClick={() => void handleCloneWorkflow(record)}
                >
                  复制模板
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card
        title={`知识库配置（${knowledgeBaseProfiles.length}）`}
        size="small"
        style={{ marginTop: 16 }}
      >
        <Form
          form={knowledgeBaseForm}
          layout="inline"
          style={{ marginBottom: 16 }}
        >
          <Form.Item
            name="key"
            rules={[{ required: true, message: '请输入 Key' }]}
          >
            <Input placeholder="项目 Key 或文档类型" />
          </Form.Item>
          <Form.Item
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="知识库名称" />
          </Form.Item>
          <Form.Item name="documentType" initialValue="general">
            <Select
              style={{ width: 130 }}
              options={[
                'prd',
                'api',
                'design',
                'test',
                'config',
                'general',
              ].map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item name="chunkSize" label="Chunk (est. tokens)" initialValue={500}>
            <InputNumber
              min={200}
              max={4000}
            />
          </Form.Item>
          <Form.Item name="chunkOverlap" label="Overlap (est. tokens)" initialValue={50}>
            <InputNumber
              min={0}
              max={1000}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            style={{ width: '100%', marginBottom: 12 }}
            title="Chunk 大小和重叠量只影响后续按该配置入库的文档；已有文档不会自动重切。下面的检索参数可用同一问题做 A/B 对照。"
          />
          <Collapse
            style={{ width: '100%', marginBottom: 12 }}
            items={[
              {
                key: 'retrieval-config',
                label: '检索调优参数（可选）',
                children: (
                  <Space wrap>
                    <Form.Item name={['retrievalConfig', 'candidateDepth']} label="候选深度">
                      <InputNumber
                        min={1}
                        max={50}
                        placeholder="默认值"
                      />
                    </Form.Item>
                    <Form.Item name={['retrievalConfig', 'finalTopK']} label="最终片段数">
                      <InputNumber
                        min={1}
                        max={20}
                        placeholder="默认值"
                      />
                    </Form.Item>
                    <Form.Item name={['retrievalConfig', 'neighborWindow']} label="邻近片段">
                      <InputNumber
                        min={0}
                        max={2}
                        placeholder="默认值"
                      />
                    </Form.Item>
                    <Form.Item name={['retrievalConfig', 'sameSectionLimit']} label="同节上限">
                      <InputNumber
                        min={0}
                        max={4}
                        placeholder="默认值"
                      />
                    </Form.Item>
                    <Form.Item
                      name={['retrievalConfig', 'contextCharacterBudget']}
                      label="上下文字符数"
                    >
                      <InputNumber
                        min={1000}
                        max={12000}
                        step={500}
                        placeholder="默认值"
                      />
                    </Form.Item>
                    <Form.Item
                      name={['retrievalConfig', 'maxChunksPerDocument']}
                      label="单文档片段上限"
                    >
                      <InputNumber
                        min={1}
                        max={8}
                        placeholder="默认值"
                      />
                    </Form.Item>
                  </Space>
                ),
              },
            ]}
          />
          <Button
            type="primary"
            loading={governanceLoading}
            onClick={() => void handleRegisterKnowledgeBase()}
          >
            保存配置
          </Button>
        </Form>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={knowledgeBaseProfiles}
          columns={[
            { title: '配置', dataIndex: 'name' },
            { title: 'Key', dataIndex: 'key' },
            { title: '文档类型', dataIndex: 'documentType' },
            {
              title: 'Est. tokens (chunk／overlap)',
              render: (_, row) => `${row.chunkSize}／${row.chunkOverlap}`,
            },
            {
              title: '检索参数',
              render: (_, row) =>
                JSON.stringify(parseRetrievalConfig(row.retrievalConfig)),
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value) => <Tag>{value}</Tag>,
            },
            {
              title: '操作',
              render: (_, row) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() =>
                      knowledgeBaseForm.setFieldsValue({
                        ...row,
                        retrievalConfig: parseRetrievalConfig(
                          row.retrievalConfig,
                        ),
                        syncConfig: parseRetrievalConfig(row.syncConfig),
                      })
                    }
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void handleCloneKnowledgeBaseProfile(row)}
                  >
                    复制调优版
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Card
        title="评测集（Bad Case 审核通过后沉淀）"
        size="small"
        style={{ marginTop: 16 }}
      >
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={evaluationCases}
          columns={[
            { title: '问题', dataIndex: 'query', ellipsis: true },
            { title: '期望答案', dataIndex: 'expectedAnswer', ellipsis: true },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value) => <Tag>{value}</Tag>,
            },
          ]}
        />
      </Card>
      <Card title="检索调试" size="small" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={retrievalProfileKey}
            onChange={setRetrievalProfileKey}
            style={{ width: 180 }}
            options={knowledgeBaseProfiles.map((profile) => ({
              value: profile.key,
              label: `A · ${profile.name}`,
            }))}
          />
          <Select
            value={retrievalCompareProfileKey || undefined}
            onChange={(value) => setRetrievalCompareProfileKey(value ?? '')}
            allowClear
            placeholder="B 配置（可选）"
            style={{ width: 220 }}
            options={knowledgeBaseProfiles.map((profile) => ({
              value: profile.key,
              label: `B · ${profile.name}`,
            }))}
          />
          <Input
            value={retrievalQuery}
            onChange={(event) => setRetrievalQuery(event.target.value)}
            onPressEnter={() => void handleRunRetrievalDebug()}
            placeholder="输入问题，查看关键词、语义、图谱、融合和重排结果"
          />
          <Button
            type="primary"
            disabled={!retrievalQuery.trim()}
            loading={retrievalDebugLoading}
            onClick={() => void handleRunRetrievalDebug()}
          >
            {retrievalCompareProfileKey ? '同题对照' : '调试检索'}
          </Button>
        </div>
        <Alert
          showIcon
          type="info"
          style={{ marginTop: 12 }}
          title="同题对照只切换检索参数；查询、管理服务身份和 RAG 文档权限保持一致。当前只检索管理服务身份可访问的资料；结果为空不代表普通用户也检索不到。它用于观察候选与上下文变化，不代替真实问题集评测。"
        />
        {retrievalDebugVariants && (
          <div className="agent-ops-form-grid" style={{ marginTop: 16 }}>
            {retrievalDebugVariants.map(({ key, result }) => {
              const name =
                knowledgeBaseProfiles.find((profile) => profile.key === key)
                  ?.name ?? key;
              return (
                <div key={key}>
                  {retrievalDebugCard(`${name}（${key}）`, result)}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );

  return { evalPanel, governancePanel };
}
