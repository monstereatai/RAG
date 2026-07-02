import {
  DownloadOutlined,
  FileTextOutlined,
  FullscreenOutlined,
  MinusOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { ModulePage, graphNav } from '@/components/AdminShell';
import { useLocation } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { FormInstance } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import GraphVisualization from './components/graph-visualization';
import {
  getGraphNodeDetail,
  getGraphNodes,
  getGraphRelations,
  getGraphStats,
  searchGraph,
  searchGraphRelations,
  type GraphEdge,
  type GraphNode,
  type GraphResponseMeta,
  type GraphStats,
  updateGraphNode,
} from './service';

type GraphState = 'loading' | 'data' | 'empty' | 'disabled' | 'error';
type GraphView = 'global' | 'nodes' | 'relations' | 'stats';

const getActiveView = (pathname: string): GraphView => {
  if (pathname.endsWith('/nodes')) return 'nodes';
  if (pathname.endsWith('/relations')) return 'relations';
  if (pathname.endsWith('/stats')) return 'stats';
  return 'global';
};

const asPayload = <T,>(res: any): T => ((res?.data ?? res) || {}) as T;
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value : []);

const isGraphDisabled = (value: any) =>
  value?.statusCode === 503 ||
  value?.disabled ||
  value?.available === false ||
  String(value?.message ?? value?.error ?? '').includes('GraphRAG is disabled');

const DemoAlert: React.FC<{ meta?: GraphResponseMeta }> = ({ meta }) =>
  meta?.demo ? (
    <Alert
      message="当前展示的是演示图谱数据，尚未接入真实 Neo4j 图谱。"
      showIcon
      style={{ marginBottom: 12 }}
      type="warning"
    />
  ) : null;

const EmptyBlock: React.FC<{
  title: string;
  desc: string;
  action?: React.ReactNode;
  panel?: boolean;
}> = ({
  title,
  desc,
  action,
  panel = true,
}) => (
  <div className={`${panel ? 'rag-panel ' : ''}graph-empty`}>
    <h3>{title}</h3>
    <p>{desc}</p>
    {action}
  </div>
);

const GraphOps: React.FC = () => {
  const location = useLocation();
  const activeView = getActiveView(location.pathname);

  return (
    <ModulePage activeKey={activeView} navItems={graphNav} title="知识图谱">
      {activeView === 'global' && <GlobalGraphView />}
      {activeView === 'nodes' && <NodeManagementView />}
      {activeView === 'relations' && <RelationSearchView />}
      {activeView === 'stats' && <GraphStatsView />}
    </ModulePage>
  );
};

const GlobalGraphView: React.FC = () => {
  const [form] = Form.useForm();
  const [graphState, setGraphState] = useState<GraphState>('loading');
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [meta, setMeta] = useState<GraphResponseMeta | undefined>();
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchGraph = () => {
    setGraphState('loading');
    Promise.all([getGraphStats(), searchGraph('知识图谱')])
      .then(([statsRes, searchRes]) => {
        const statsPayload = asPayload<{ data?: GraphStats; meta?: GraphResponseMeta }>(statsRes);
        const searchPayload = asPayload<{
          data?: { nodes?: GraphNode[]; edges?: GraphEdge[] };
          meta?: GraphResponseMeta;
        }>(searchRes);

        if (isGraphDisabled(statsPayload) || isGraphDisabled(statsPayload.data)) {
          setGraphState('disabled');
          return;
        }

        const statsData = (statsPayload as any).data ?? (statsPayload as GraphStats);
        const graphNodes = asArray<GraphNode>((searchPayload as any)?.nodes ?? []);
        const graphEdges = asArray<GraphEdge>((searchPayload as any)?.edges ?? []);

        setStats(statsData);
        setNodes(graphNodes);
        setEdges(graphEdges);
        setMeta((searchPayload as any)?.meta);
        setGraphState((statsData?.nodeCount ?? 0) > 0 || graphNodes.length > 0 ? 'data' : 'empty');
      })
      .catch(() => setGraphState('error'));
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  const openEditNode = (node: GraphNode) => {
    setEditingNode(node);
    form.setFieldsValue(toNodeFormValues(node));
  };

  const handleSaveNode = async () => {
    if (!editingNode) return;
    const values = await form.validateFields();
    const payload = parseNodeFormValues(values);
    if (!payload) return;

    setSaving(true);
    try {
      const res = await updateGraphNode(editingNode.id, payload);
      const response = asPayload<{ data?: GraphNode & { relations?: GraphEdge[] } }>(res);
      const updated = response.data;
      if (updated) {
        setNodes((prev) => prev.map((node) => (node.id === updated.id ? { ...node, ...updated } : node)));
      }
      setEditingNode(null);
      message.success('节点已更新');
      fetchGraph();
    } catch {
      message.error('节点更新失败，请检查 Neo4j 图谱服务状态');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <GraphFilterBar onSearch={fetchGraph} />
      <DemoAlert meta={meta} />

      {graphState === 'disabled' && (
        <EmptyBlock
          desc="Neo4j 知识图谱功能当前未启用。请在 rag-backend 启用 GRAPH_RAG_ENABLED=true 并确保 Neo4j 服务运行。"
          title="知识图谱未启用"
        />
      )}

      {graphState === 'loading' && (
        <div className="graph-layout">
          <div className="rag-panel graph-canvas">
            <Skeleton active paragraph={{ rows: 12 }} />
          </div>
          <aside className="graph-side">
            <Skeleton active paragraph={{ rows: 8 }} />
          </aside>
        </div>
      )}

      {graphState === 'empty' && (
        <EmptyBlock desc="知识图谱尚未生成，请先上传文档并执行实体关系抽取。" title="图谱为空" />
      )}

      {graphState === 'error' && (
        <EmptyBlock
          action={
            <Button icon={<ReloadOutlined />} onClick={fetchGraph} type="primary">
              重新加载
            </Button>
          }
          desc="无法加载图谱数据，请确认 Neo4j、rag-backend 和 admin-backend 服务正常运行。"
          title="加载失败"
        />
      )}

      {graphState === 'data' && (
        <div className="graph-layout">
          <div className="rag-panel graph-canvas">
            <GraphVisualization
              edges={edges}
              height={620}
              nodes={nodes}
              onNodeEdit={openEditNode}
            />
            <GraphLegend />
            <div className="graph-controls">
              <Button icon={<FullscreenOutlined />} />
              <Button icon={<MinusOutlined />} />
              <span>100%</span>
              <Button icon={<PlusOutlined />} />
            </div>
          </div>
          <GraphSide stats={stats} nodes={nodes} />
        </div>
      )}
      <GraphNodeEditModal
        form={form}
        node={editingNode}
        onCancel={() => setEditingNode(null)}
        onOk={handleSaveNode}
        saving={saving}
      />
    </>
  );
};

const NodeManagementView: React.FC = () => {
  const [form] = Form.useForm();
  const [state, setState] = useState<GraphState>('loading');
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [nodeType, setNodeType] = useState<string | undefined>();
  const [meta, setMeta] = useState<GraphResponseMeta | undefined>();
  const [activeNode, setActiveNode] = useState<(GraphNode & { relations?: GraphEdge[] }) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchNodes = () => {
    setState('loading');
    getGraphNodes({
      keyword: keyword || undefined,
      type: nodeType,
      page: 1,
      pageSize: 50,
    })
      .then((res) => {
        const payload = asPayload<{ data?: GraphNode[]; total?: number; meta?: GraphResponseMeta }>(res);
        if (isGraphDisabled(payload)) {
          setState('disabled');
          return;
        }
        const items = asArray<GraphNode>(payload ?? []);
        setNodes(items);
        setTotal(items.length);
        setMeta(undefined);
        setState(items.length > 0 ? 'data' : 'empty');
      })
      .catch(() => setState('error'));
  };

  useEffect(() => {
    fetchNodes();
  }, []);

  const openNode = (node: GraphNode) => {
    setDetailLoading(true);
    setActiveNode(node);
    getGraphNodeDetail(node.id)
      .then((res) => {
        const payload = asPayload<{ data?: GraphNode & { relations?: GraphEdge[] } }>(res);
        setActiveNode(payload.data ?? node);
      })
      .finally(() => setDetailLoading(false));
  };

  const openEditNode = (node: GraphNode) => {
    setEditingNode(node);
    form.setFieldsValue(toNodeFormValues(node));
  };

  const handleSaveNode = async () => {
    if (!editingNode) return;
    const values = await form.validateFields();
    const payload = parseNodeFormValues(values);
    if (!payload) return;

    setSaving(true);
    try {
      const res = await updateGraphNode(editingNode.id, payload);
      const response = asPayload<{ data?: GraphNode & { relations?: GraphEdge[] } }>(res);
      const updated = response.data;
      if (updated) {
        setNodes((prev) => prev.map((node) => (node.id === updated.id ? { ...node, ...updated } : node)));
        setActiveNode((prev) => (prev?.id === updated.id ? updated : prev));
      }
      setEditingNode(null);
      message.success('节点已更新');
      fetchNodes();
    } catch {
      message.error('节点更新失败，请检查 Neo4j 图谱服务状态');
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = useMemo(
    () =>
      Array.from(new Set(nodes.map((node) => node.type).filter(Boolean))).map((type) => ({
        label: type,
        value: type,
      })),
    [nodes],
  );

  const columns: ColumnsType<GraphNode> = [
    {
      title: '节点名称',
      dataIndex: 'label',
      render: (value, record) => (
        <Button onClick={() => openNode(record)} type="link">
          {value}
        </Button>
      ),
    },
    { title: '类型', dataIndex: 'type', width: 140, render: (value) => <Tag color="blue">{value}</Tag> },
    {
      title: '关联关系数',
      dataIndex: 'relationshipCount',
      width: 130,
      render: (value) => Number(value ?? 0),
    },
    { title: '来源', dataIndex: 'sourceId', width: 180, render: (value) => value || '-' },
    {
      title: '置信度',
      dataIndex: 'confidence',
      width: 110,
      render: (value) => (typeof value === 'number' ? value.toFixed(2) : '-'),
    },
    { title: '最近更新', dataIndex: 'updatedAt', width: 180, render: (value) => value || '-' },
    {
      title: '操作',
      width: 150,
      render: (_, record) => (
        <Space size={6}>
          <Button onClick={() => openNode(record)} size="small">
            详情
          </Button>
          <Button onClick={() => openEditNode(record)} size="small" type="primary">
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="rag-panel graph-filter graph-manage-filter">
        <Input
          allowClear
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={fetchNodes}
          placeholder="搜索节点名称、别名、属性..."
          prefix={<SearchOutlined />}
          value={keyword}
        />
        <span>节点类型</span>
        <Select
          allowClear
          onChange={setNodeType}
          options={typeOptions}
          placeholder="全部"
          value={nodeType}
        />
        <span>业务分类</span>
        <Select disabled placeholder="待接入" />
        <span>是否孤立</span>
        <Select disabled placeholder="全部" />
        <Button onClick={() => {
          setKeyword('');
          setNodeType(undefined);
        }}>
          重置
        </Button>
        <Button onClick={fetchNodes} type="primary">搜索</Button>
      </div>
      <DemoAlert meta={meta} />
      <div className="rag-panel graph-table-panel">
        {state === 'loading' && <Skeleton active paragraph={{ rows: 10 }} />}
        {state === 'disabled' && <EmptyBlock desc="Neo4j 未启用，节点列表不可用。" panel={false} title="知识图谱未启用" />}
        {state === 'error' && <EmptyBlock desc="节点列表加载失败，请检查服务状态。" panel={false} title="加载失败" />}
        {state === 'empty' && <EmptyBlock desc="当前没有可管理的图谱节点。" panel={false} title="暂无节点" />}
        {state === 'data' && (
          <Table columns={columns} dataSource={nodes} pagination={{ pageSize: 10, total }} rowKey="id" />
        )}
      </div>
      <Drawer
        loading={detailLoading}
        onClose={() => setActiveNode(null)}
        open={!!activeNode}
        title={activeNode?.label ?? '节点详情'}
        width={520}
      >
        {activeNode && <NodeDetail node={activeNode} onEdit={() => openEditNode(activeNode)} />}
      </Drawer>
      <GraphNodeEditModal
        form={form}
        node={editingNode}
        onCancel={() => setEditingNode(null)}
        onOk={handleSaveNode}
        saving={saving}
      />
    </>
  );
};

const RelationSearchView: React.FC = () => {
  const [state, setState] = useState<GraphState>('loading');
  const [relations, setRelations] = useState<GraphEdge[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [keyword, setKeyword] = useState('');
  const [relationType, setRelationType] = useState<string | undefined>();
  const [conflictOnly, setConflictOnly] = useState(false);
  const [meta, setMeta] = useState<GraphResponseMeta | undefined>();

  const fetchRelations = () => {
    setState('loading');
    Promise.all([
      getGraphRelations({
        query: keyword || undefined,
        relationType,
        conflictOnly,
        limit: 50,
      }),
      searchGraphRelations({
        query: keyword || undefined,
        relationType,
        conflictOnly,
        limit: 50,
      }),
    ])
      .then(([relationRes, graphRes]) => {
        const relationPayload = asPayload<{ data?: GraphEdge[]; meta?: GraphResponseMeta }>(relationRes);
        const graphPayload = asPayload<{
          data?: { nodes?: GraphNode[]; edges?: GraphEdge[] };
          meta?: GraphResponseMeta;
        }>(graphRes);
        if (isGraphDisabled(relationPayload)) {
          setState('disabled');
          return;
        }
        const edges = asArray<GraphEdge>(relationPayload ?? []);
        setRelations(edges);
        setGraphNodes(asArray<GraphNode>((graphPayload as any)?.nodes ?? []));
        setMeta(undefined);
        setState(edges.length > 0 ? 'data' : 'empty');
      })
      .catch(() => setState('error'));
  };

  useEffect(() => {
    fetchRelations();
  }, []);

  const relationOptions = useMemo(
    () =>
      Array.from(new Set(relations.map((item) => item.label).filter(Boolean))).map((type) => ({
        label: type,
        value: type,
      })),
    [relations],
  );

  const columns: ColumnsType<GraphEdge> = [
    { title: '来源节点', dataIndex: 'sourceLabel', render: (value, record) => value || record.source },
    { title: '关系', dataIndex: 'label', width: 140, render: (value) => <Tag color="green">{value}</Tag> },
    { title: '目标节点', dataIndex: 'targetLabel', render: (value, record) => value || record.target },
    {
      title: '置信度',
      dataIndex: 'confidence',
      width: 110,
      render: (value) => (typeof value === 'number' ? value.toFixed(2) : '-'),
    },
    { title: '来源', dataIndex: 'sourceId', width: 180, render: (value) => value || '-' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: (value) => value || '-' },
  ];

  return (
    <>
      <div className="rag-panel graph-filter graph-relation-filter">
        <Input
          allowClear
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={fetchRelations}
          placeholder="搜索起点、终点、关系或属性..."
          prefix={<SearchOutlined />}
          value={keyword}
        />
        <span>关系类型</span>
        <Select
          allowClear
          onChange={setRelationType}
          options={relationOptions}
          placeholder="全部"
          value={relationType}
        />
        <span>路径深度</span>
        <Select defaultValue={1} options={[{ value: 1, label: '1 跳' }, { value: 2, label: '2 跳' }]} />
        <Checkbox checked={conflictOnly} onChange={(event) => setConflictOnly(event.target.checked)}>
          仅冲突关系
        </Checkbox>
        <Button onClick={fetchRelations} type="primary">搜索</Button>
      </div>
      <DemoAlert meta={meta} />
      <div className="graph-relation-layout">
        <div className="rag-panel graph-table-panel">
          {state === 'loading' && <Skeleton active paragraph={{ rows: 10 }} />}
          {state === 'disabled' && <EmptyBlock desc="Neo4j 未启用，关系检索不可用。" panel={false} title="知识图谱未启用" />}
          {state === 'error' && <EmptyBlock desc="关系检索加载失败，请检查服务状态。" panel={false} title="加载失败" />}
          {state === 'empty' && <EmptyBlock desc="没有匹配的图谱关系。" panel={false} title="暂无关系" />}
          {state === 'data' && (
            <Table columns={columns} dataSource={relations} pagination={{ pageSize: 10 }} rowKey="id" />
          )}
        </div>
        <div className="rag-panel graph-mini-panel">
          <div className="panel-head">
            <h3>局部图谱</h3>
            <Tag>{graphNodes.length} 节点 / {relations.length} 关系</Tag>
          </div>
          <GraphVisualization edges={relations} height={430} nodes={graphNodes} />
        </div>
      </div>
    </>
  );
};

const GraphStatsView: React.FC = () => {
  const [state, setState] = useState<GraphState>('loading');
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [meta, setMeta] = useState<GraphResponseMeta | undefined>();

  const fetchStats = () => {
    setState('loading');
    getGraphStats()
      .then((res) => {
        const payload = asPayload<{ data?: GraphStats; meta?: GraphResponseMeta }>(res);
        if (isGraphDisabled(payload) || isGraphDisabled((payload as any)?.data)) {
          setState('disabled');
          return;
        }
        const statsData = (payload as any)?.data ?? payload;
        setStats(statsData as GraphStats);
        setMeta(undefined);
        setState((statsData?.nodeCount ?? 0) > 0 || (statsData?.edgeCount ?? 0) > 0 ? 'data' : 'empty');
      })
      .catch(() => setState('error'));
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (state === 'loading') {
    return <Skeleton active paragraph={{ rows: 12 }} />;
  }
  if (state === 'disabled') {
    return <EmptyBlock desc="Neo4j 未启用，统计不可用。" title="知识图谱未启用" />;
  }
  if (state === 'error') {
    return (
      <EmptyBlock
        action={<Button onClick={fetchStats} type="primary">重新加载</Button>}
        desc="图谱统计加载失败，请检查服务状态。"
        title="加载失败"
      />
    );
  }
  if (state === 'empty' || !stats) {
    return <EmptyBlock desc="当前没有可统计的图谱数据。" title="暂无统计数据" />;
  }

  return (
    <>
      <DemoAlert meta={meta} />
      <div className="graph-stat-grid">
        {[
          { label: '节点总数', value: stats.nodeCount },
          { label: '关系总数', value: stats.edgeCount },
          { label: '孤立节点', value: stats.orphanCount ?? 0 },
          { label: '冲突关系', value: stats.conflictCount ?? 0 },
          { label: '节点类型', value: stats.entityTypes?.length ?? 0 },
          { label: '关系类型', value: stats.relationTypes?.length ?? 0 },
        ].map((item) => (
          <Card key={item.label} size="small">
            <Statistic title={item.label} value={item.value} />
          </Card>
        ))}
      </div>
      <div className="graph-stat-layout">
        <GraphTypePanel items={stats.entityTypes ?? []} title="节点类型分布" />
        <GraphTypePanel items={stats.relationTypes ?? []} title="关系类型分布" />
        <GraphNodeList nodes={stats.popularNodes ?? []} title="热门节点 Top 10" />
        <GraphNodeList nodes={stats.orphanNodes ?? []} title="孤立节点治理" />
      </div>
    </>
  );
};

const GraphFilterBar: React.FC<{ onSearch: () => void }> = ({ onSearch }) => (
  <div className="rag-panel graph-filter">
    <Input prefix={<SearchOutlined />} placeholder="请输入关键词搜索图谱..." />
    <span>节点类型</span>
    <Select defaultValue="全部" options={[{ value: '全部' }]} />
    <span>业务分类</span>
    <Select defaultValue="全部" options={[{ value: '全部' }]} />
    <span>创建时间</span>
    <DatePicker.RangePicker />
    <Button>重置</Button>
    <Button onClick={onSearch} type="primary">搜索</Button>
    <Button icon={<DownloadOutlined />}>导出图谱</Button>
  </div>
);

const GraphLegend = () => (
  <div className="graph-legend">
    <span><i className="blue" />文档</span>
    <span><i className="green" />知识点</span>
    <span><i className="purple" />标签</span>
    <span><i className="orange" />业务分类</span>
    <span>— 关联</span>
    <span>→ 引用</span>
  </div>
);

const GraphSide: React.FC<{ stats: GraphStats | null; nodes: GraphNode[] }> = ({ stats, nodes }) => (
  <aside className="graph-side">
    <div className="rag-panel graph-stats">
      <h3>图谱数据统计</h3>
      <div>
        {[
          { label: '节点总数', value: stats?.nodeCount ?? nodes.length, Icon: NodeIndexOutlined },
          { label: '关系总数', value: stats?.edgeCount ?? 0, Icon: NodeIndexOutlined },
        ].map(({ label, value, Icon }) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{Number(value).toLocaleString()}</strong>
            <Icon />
          </article>
        ))}
      </div>
    </div>
    <div className="rag-panel graph-list">
      <h3>当前图谱节点 ({nodes.length})</h3>
      {nodes.slice(0, 8).map((node) => (
        <p key={node.id}>
          <FileTextOutlined /> {node.label}
          <span>({node.type})</span>
        </p>
      ))}
    </div>
  </aside>
);

const toNodeFormValues = (node: GraphNode) => ({
  label: node.label,
  type: node.type,
  aliases: node.aliases?.join('、') ?? '',
  sourceId: node.sourceId,
  properties: JSON.stringify(node.properties ?? {}, null, 2),
});

const parseNodeFormValues = (values: any) => {
  let properties: Record<string, any> = {};
  try {
    properties = values.properties?.trim()
      ? JSON.parse(values.properties)
      : {};
  } catch {
    message.error('属性必须是合法 JSON 对象');
    return null;
  }
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    message.error('属性必须是合法 JSON 对象');
    return null;
  }

  return {
    type: values.type?.trim(),
    aliases: String(values.aliases ?? '')
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
    sourceId: values.sourceId?.trim(),
    properties,
  };
};

const GraphNodeEditModal: React.FC<{
  form: FormInstance;
  node: GraphNode | null;
  onCancel: () => void;
  onOk: () => void;
  saving: boolean;
}> = ({ form, node, onCancel, onOk, saving }) => (
  <Modal
    confirmLoading={saving}
    destroyOnHidden
    okText="保存"
    onCancel={onCancel}
    onOk={onOk}
    open={!!node}
    title="编辑节点"
    width={640}
  >
    <Form form={form} layout="vertical">
      <Form.Item label="节点名称" name="label">
        <Input disabled />
      </Form.Item>
      <Form.Item
        label="节点类型"
        name="type"
        rules={[{ required: true, message: '请输入节点类型' }]}
      >
        <Input placeholder="例如 Framework / Database / LLM" />
      </Form.Item>
      <Form.Item label="别名" name="aliases">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="多个别名用逗号、顿号或换行分隔"
        />
      </Form.Item>
      <Form.Item label="来源" name="sourceId">
        <Input placeholder="来源文档或导入批次" />
      </Form.Item>
      <Form.Item
        label="属性 JSON"
        name="properties"
        rules={[{ required: true, message: '请输入属性 JSON' }]}
      >
        <Input.TextArea
          autoSize={{ minRows: 8, maxRows: 14 }}
          spellCheck={false}
        />
      </Form.Item>
    </Form>
  </Modal>
);

const NodeDetail: React.FC<{
  node: GraphNode & { relations?: GraphEdge[] };
  onEdit?: () => void;
}> = ({ node, onEdit }) => (
  <div className="graph-detail">
    <Button onClick={onEdit} style={{ marginBottom: 12 }} type="primary">
      编辑节点
    </Button>
    <dl>
      <dt>节点 ID</dt>
      <dd>{node.id}</dd>
      <dt>节点类型</dt>
      <dd><Tag color="blue">{node.type}</Tag></dd>
      <dt>来源</dt>
      <dd>{node.sourceId || '-'}</dd>
      <dt>别名</dt>
      <dd>{node.aliases?.length ? node.aliases.join('、') : '-'}</dd>
    </dl>
    <h3>属性</h3>
    <pre>{JSON.stringify(node.properties ?? {}, null, 2)}</pre>
    <h3>相关关系</h3>
    {(node.relations ?? []).length > 0 ? (
      (node.relations ?? []).map((rel) => (
        <p key={rel.id}>
          {rel.sourceLabel || rel.source} <Tag color="green">{rel.label}</Tag> {rel.targetLabel || rel.target}
        </p>
      ))
    ) : (
      <p className="muted">暂无相关关系</p>
    )}
  </div>
);

const GraphTypePanel: React.FC<{ title: string; items: { type: string; count: number }[] }> = ({
  title,
  items,
}) => (
  <div className="rag-panel graph-type-panel">
    <div className="panel-head">
      <h3>{title}</h3>
    </div>
    {items.length > 0 ? (
      items.map((item) => (
        <p key={item.type}>
          <span>{item.type}</span>
          <strong>{item.count}</strong>
        </p>
      ))
    ) : (
      <p className="muted">暂无数据</p>
    )}
  </div>
);

const GraphNodeList: React.FC<{ title: string; nodes: GraphNode[] }> = ({ title, nodes }) => (
  <div className="rag-panel graph-type-panel">
    <div className="panel-head">
      <h3>{title}</h3>
    </div>
    {nodes.length > 0 ? (
      nodes.slice(0, 10).map((node) => (
        <p key={node.id}>
          <span>{node.label}</span>
          <Tag>{node.type}</Tag>
        </p>
      ))
    ) : (
      <p className="muted">暂无数据</p>
    )}
  </div>
);

export default GraphOps;
