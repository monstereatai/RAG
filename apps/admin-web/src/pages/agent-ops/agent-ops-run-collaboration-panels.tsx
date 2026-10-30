import { ReloadOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  message,
  Select,
  Table,
  Tag,
} from 'antd';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';
import type { AgentOpsController } from './agent-ops-controller';
import {
  getCollaborationConflicts,
  getCollaborationReplay,
  retryAgentRunRecord,
  retryAgentTask,
  unwrapData,
} from './service';

export function renderRunCenterPanelAndCollaborationPanel(
  controller: AgentOpsController,
) {
  const {
    decisionForm,
    delegateForm,
    runOptions,
    runCenter,
    collaborationSops,
    collaborationMessages,
    artifactDependencies,
    decisionRecords,
    collaborationReplay,
    setCollaborationReplay,
    collaborationConflicts,
    setCollaborationConflicts,
    agentTasks,
    collaborationLoading,
    runtimeEvents,
    runtimeMetrics,
    runtimeRunId,
    setRuntimeRunId,
    loadRunOptions,
    loadRunCenter,
    loadCollaboration,
    handleCreateDecision,
    handleDelegateTask,
  } = controller;
  const runCenterPanel = (
    <section className="agent-ops-panel">
      <Alert
        showIcon
        type="info"
        title="Agent 运行中心"
        description="集中查看问答与产研运工作流的路由、状态、动作、重试和估算成本；产研运工作流以 production_workflow 路由显示，点击“运行详情”可回放岗位检索、交付物、审批与最终结果。"
      />
      <Button
        icon={<ReloadOutlined />}
        onClick={() => void loadRunCenter()}
        style={{ margin: '16px 0' }}
      >
        刷新运行记录
      </Button>
      <Table
        rowKey="id"
        dataSource={runCenter}
        pagination={{ pageSize: 10 }}
        expandable={{
          expandedRowRender: (record) => (
            <Descriptions
              size="small"
              column={3}
              items={[
                {
                  key: 'thread',
                  label: 'Thread',
                  children: record.threadId || '-',
                },
                {
                  key: 'node',
                  label: '当前节点',
                  children: record.currentNode || '-',
                },
                {
                  key: 'max',
                  label: '最大步数',
                  children: record.maxSteps ?? '-',
                },
                {
                  key: 'approval',
                  label: '审批标记',
                  children: record.requiresApproval ? '需要审批' : '无需审批',
                },
                {
                  key: 'created',
                  label: '开始时间',
                  children: record.createdAt || '-',
                },
                {
                  key: 'finished',
                  label: '结束时间',
                  children: record.finishedAt || '-',
                },
                {
                  key: 'summary',
                  label: '结果摘要',
                  span: 3,
                  children: record.resultSummary ? (
                    <div className="answer-card run-result-preview agent-run-center-summary">
                      <AssistantMarkdown
                        content={String(record.resultSummary)}
                        status="done"
                      />
                    </div>
                  ) : (
                    record.errorMessage || '-'
                  ),
                },
                {
                  key: 'goal',
                  label: '目标状态',
                  span: 3,
                  children: record.goal ? (
                    <span className="agent-run-center-goal">
                      {record.goal.status}：{record.goal.objective}
                      {record.goal.reason ? `；${record.goal.reason}` : ''}
                    </span>
                  ) : (
                    '-'
                  ),
                },
              ]}
            />
          ),
        }}
        columns={[
          { title: '运行 ID', dataIndex: 'id', ellipsis: true },
          { title: '模式', dataIndex: 'mode' },
          {
            title: '路由／来源',
            dataIndex: 'route',
            render: (value) =>
              value === 'production_workflow' ? (
                <Tag color="purple">产研运工作流</Tag>
              ) : (
                value || '问答'
              ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (value) => (
              <Tag
                color={
                  value === 'completed'
                    ? 'success'
                    : value === 'failed'
                      ? 'error'
                      : 'processing'
                }
              >
                {value}
              </Tag>
            ),
          },
          { title: '动作', dataIndex: 'actionCount' },
          { title: '重试', dataIndex: 'retryCount' },
          {
            title: '估算成本',
            dataIndex: 'costUsd',
            render: (value) => `$${Number(value ?? 0).toFixed(4)}`,
          },
          {
            title: '操作',
            render: (_, record) => (
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <Button
                  size="small"
                  onClick={() =>
                    history.push(
                      `/agent-ops/run-center/${encodeURIComponent(record.id)}`,
                    )
                  }
                >
                  运行详情
                </Button>
                <Button
                  size="small"
                  disabled={
                    !['failed', 'cancelled'].includes(record.status) ||
                    !['auto', 'agentic'].includes(record.mode) ||
                    record.route === 'simple' ||
                    record.route === 'production_workflow'
                  }
                  onClick={() =>
                    void retryAgentRunRecord(record.id)
                      .then((response) => {
                        const result = unwrapData<{
                          runId?: string;
                          status?: string;
                        }>(response);
                        if (!result?.runId) {
                          throw new Error('服务没有返回新的运行记录');
                        }
                        message.success(
                          result.status === 'waiting_approval'
                            ? 'Agentic 重跑已暂停，等待审批'
                            : 'Agentic 链路重跑完成',
                        );
                        history.push(
                          `/agent-ops/run-center/${encodeURIComponent(result.runId)}`,
                        );
                      })
                      .catch((error) =>
                        message.error(
                          error instanceof Error
                            ? error.message
                            : 'Agentic 重跑失败',
                        ),
                      )
                  }
                >
                  重跑 Agentic 链路
                </Button>
              </span>
            ),
          },
        ]}
      />
    </section>
  );

  const collaborationPanel = (
    <section className="agent-ops-panel">
      <Alert
        showIcon
        type="info"
        title="多 Agent 协作编排"
        description="把角色 Prompt 固化为 SOP，把上下游交接固化为结构化消息，把 Artifact 依赖和冲突决策纳入同一条可回放链路。"
      />
      <Button
        icon={<ReloadOutlined />}
        loading={collaborationLoading}
        onClick={() => void loadCollaboration()}
        style={{ margin: '16px 0' }}
      >
        刷新协作数据
      </Button>
      <Card title={`Agent SOP（${collaborationSops.length}）`} size="small">
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={collaborationSops}
          columns={[
            { title: '角色', dataIndex: 'role' },
            { title: 'SOP', dataIndex: 'name' },
            { title: '版本', dataIndex: 'version' },
            { title: '最大步数', dataIndex: 'maxSteps' },
            {
              title: '输入契约',
              dataIndex: 'inputContract',
              render: (value) => JSON.stringify(value),
            },
            {
              title: '输出契约',
              dataIndex: 'outputContract',
              render: (value) => JSON.stringify(value),
            },
          ]}
        />
      </Card>
      <Card
        title={`Task 看板（${agentTasks.length}）`}
        size="small"
        style={{ marginTop: 16 }}
      >
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 8 }}
          dataSource={agentTasks}
          columns={[
            { title: '任务', dataIndex: 'title' },
            { title: '角色', dataIndex: 'role' },
            { title: 'Process', dataIndex: 'processType' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value) => (
                <Tag
                  color={
                    value === 'completed'
                      ? 'success'
                      : value === 'waiting_approval'
                        ? 'warning'
                        : value === 'failed'
                          ? 'error'
                          : 'processing'
                  }
                >
                  {value}
                </Tag>
              ),
            },
            { title: '重试', dataIndex: 'retryCount' },
            {
              title: '产物',
              dataIndex: 'outputArtifactId',
              render: (value) => value || '-',
            },
            {
              title: '操作',
              render: (_, record) => (
                <Button
                  size="small"
                  disabled={record.status !== 'failed'}
                  onClick={() =>
                    void retryAgentTask(record.id)
                      .then(() => {
                        message.success('Task 已重新排队并触发执行');
                        return loadCollaboration();
                      })
                      .catch(() => message.error('Task 重跑失败'))
                  }
                >
                  单任务重跑
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card
        title="受控委派（Agent as Tool）"
        size="small"
        style={{ marginTop: 16 }}
      >
        <Form form={delegateForm} layout="inline">
          <Form.Item
            name="threadId"
            rules={[{ required: true, message: '请输入 Thread ID' }]}
          >
            <Input placeholder="Thread ID" />
          </Form.Item>
          <Form.Item name="runId">
            <Input placeholder="Run ID（绑定委派预算，可选）" />
          </Form.Item>
          <Form.Item name="parentTaskId">
            <Input placeholder="父任务 ID（可选）" />
          </Form.Item>
          <Form.Item
            name="role"
            rules={[{ required: true, message: '请输入角色' }]}
          >
            <Input placeholder="目标 Agent 角色" />
          </Form.Item>
          <Form.Item
            name="title"
            rules={[{ required: true, message: '请输入任务标题' }]}
          >
            <Input placeholder="子任务标题" />
          </Form.Item>
          <Form.Item
            name="description"
            rules={[{ required: true, message: '请输入任务描述' }]}
          >
            <Input placeholder="任务描述" />
          </Form.Item>
          <Button type="primary" onClick={() => void handleDelegateTask()}>
            委派子任务
          </Button>
        </Form>
      </Card>
      <Card
        title={`运行事件流（${runtimeEvents.length}）`}
        size="small"
        style={{ marginTop: 16 }}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Select
            allowClear
            showSearch
            value={runtimeRunId}
            style={{ width: 420 }}
            placeholder="选择一次问答运行，仅回放该 Run 的事件"
            options={runCenter.map((run) => ({
              value: run.id,
              label: `${run.mode}／${run.route || '未路由'}／${run.status} · ${run.id}`,
            }))}
            onChange={(value) => setRuntimeRunId(value)}
          />
          <Button onClick={() => setRuntimeRunId(undefined)}>
            查看全部事件
          </Button>
        </div>
        <Descriptions
          size="small"
          bordered
          column={4}
          style={{ marginBottom: 16 }}
        >
          <Descriptions.Item label="事件总数">
            {runtimeMetrics.total ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="工具调用">
            {runtimeMetrics.toolCalls ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="节点执行">
            {runtimeMetrics.nodeStarts ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="目标完成／阻塞">{`${runtimeMetrics.goalsCompleted ?? 0}／${runtimeMetrics.goalsBlocked ?? 0}`}</Descriptions.Item>
          <Descriptions.Item label="上下文压缩">
            {runtimeMetrics.compactions ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="授权拦截">
            {runtimeMetrics.policyDenied ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="委派次数">
            {runtimeMetrics.delegations ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="预算超限">
            {
              runtimeEvents.filter(
                (item) => item.eventType === 'budget.exceeded',
              ).length
            }
          </Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 8 }}
          dataSource={runtimeEvents.slice().reverse()}
          expandable={{
            expandedRowRender: (record) => (
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(record.payload, null, 2)}
              </pre>
            ),
          }}
          columns={[
            { title: '序号', dataIndex: 'sequence' },
            {
              title: '事件',
              dataIndex: 'eventType',
              render: (value) => (
                <Tag
                  color={
                    String(value).includes('failed') ||
                    String(value).includes('blocked') ||
                    String(value).includes('denied')
                      ? 'error'
                      : String(value).includes('completed')
                        ? 'success'
                        : 'processing'
                  }
                >
                  {value}
                </Tag>
              ),
            },
            { title: '执行者', dataIndex: 'actor' },
            {
              title: '目标',
              dataIndex: 'target',
              render: (value) => value || '-',
            },
            { title: '时间', dataIndex: 'createdAt' },
          ]}
        />
      </Card>
      <div className="agent-ops-form-grid" style={{ marginTop: 16 }}>
        <Card
          title={`结构化交接消息（${collaborationMessages.length}）`}
          size="small"
        >
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 5 }}
            dataSource={collaborationMessages}
            columns={[
              { title: '来源', dataIndex: 'fromRole' },
              { title: '目标', dataIndex: 'toRole' },
              { title: '主题', dataIndex: 'subject' },
              { title: '类型', dataIndex: 'messageType' },
            ]}
          />
        </Card>
        <Card
          title={`Artifact 依赖（${artifactDependencies.length}）`}
          size="small"
        >
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 5 }}
            dataSource={artifactDependencies}
            columns={[
              { title: '产物', dataIndex: 'artifactId' },
              { title: '依赖', dataIndex: 'dependsOnArtifactId' },
              { title: '关系', dataIndex: 'relation' },
            ]}
          />
        </Card>
      </div>
      <Card
        title="Decision Record（冲突与最终决策）"
        size="small"
        style={{ marginTop: 16 }}
      >
        <Form form={decisionForm} layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item
            name="threadId"
            rules={[{ required: true, message: '请输入 Thread ID' }]}
          >
            <Input placeholder="Thread ID" />
          </Form.Item>
          <Form.Item
            name="title"
            rules={[{ required: true, message: '请输入决策标题' }]}
          >
            <Input placeholder="决策标题" />
          </Form.Item>
          <Form.Item name="conflicts">
            <Input.TextArea
              placeholder="冲突项，每行一条"
              autoSize={{ minRows: 1, maxRows: 3 }}
            />
          </Form.Item>
          <Form.Item name="options">
            <Input.TextArea
              placeholder="候选方案，每行一条"
              autoSize={{ minRows: 1, maxRows: 3 }}
            />
          </Form.Item>
          <Button type="primary" onClick={() => void handleCreateDecision()}>
            保存决策
          </Button>
        </Form>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={decisionRecords}
          columns={[
            { title: '标题', dataIndex: 'title' },
            { title: 'Thread', dataIndex: 'threadId' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value) => <Tag>{value}</Tag>,
            },
            {
              title: '冲突',
              dataIndex: 'conflicts',
              render: (value) =>
                Array.isArray(value) ? value.join('；') || '-' : '-',
            },
          ]}
        />
      </Card>
      <Card title="项目回放" size="small" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            showSearch
            style={{ width: 360 }}
            placeholder="选择 Agentic 会话"
            options={runOptions.map((item) => ({
              value: item.threadId,
              label: `${item.threadId} · ${item.mode}`,
            }))}
            onChange={(value) =>
              void Promise.all([
                getCollaborationReplay(value),
                getCollaborationConflicts(value),
              ])
                .then(([replay, conflicts]) => {
                  setCollaborationReplay(unwrapData<any>(replay));
                  setCollaborationConflicts(unwrapData<any[]>(conflicts) ?? []);
                })
                .catch(() => message.error('回放加载失败'))
            }
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void loadRunOptions()}
          >
            刷新会话
          </Button>
        </div>
        {collaborationConflicts.length > 0 && (
          <Alert
            style={{ marginTop: 16 }}
            showIcon
            type="warning"
            title={`检测到 ${collaborationConflicts.length} 个协作冲突`}
            description={
              <pre>{JSON.stringify(collaborationConflicts, null, 2)}</pre>
            }
          />
        )}
        {collaborationReplay && (
          <Collapse
            style={{ marginTop: 16 }}
            items={[
              {
                key: 'run',
                label: '运行与动作',
                children: (
                  <pre>
                    {JSON.stringify(
                      {
                        run: collaborationReplay.run,
                        actions: collaborationReplay.actions,
                      },
                      null,
                      2,
                    )}
                  </pre>
                ),
              },
              {
                key: 'artifacts',
                label: '产物与依赖',
                children: (
                  <pre>
                    {JSON.stringify(
                      {
                        artifacts: collaborationReplay.artifacts,
                        dependencies: collaborationReplay.dependencies,
                      },
                      null,
                      2,
                    )}
                  </pre>
                ),
              },
              {
                key: 'messages',
                label: '交接消息与决策',
                children: (
                  <pre>
                    {JSON.stringify(
                      {
                        messages: collaborationReplay.messages,
                        decisions: collaborationReplay.decisions,
                      },
                      null,
                      2,
                    )}
                  </pre>
                ),
              },
            ]}
          />
        )}
      </Card>
    </section>
  );

  return { runCenterPanel, collaborationPanel };
}
