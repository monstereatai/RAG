import {
  DownloadOutlined,
  FileTextOutlined,
  FolderOutlined,
  FullscreenOutlined,
  MinusOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  SearchOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { ModulePage, graphNav } from '@/components/AdminShell';
import { Button, DatePicker, Input, Select } from 'antd';
import React, { useEffect, useState } from 'react';
import GraphVisualization from './components/graph-visualization';
import { getGraphStats, searchGraph, type GraphEdge, type GraphNode, type GraphStats } from './service';

const fallbackNodes: GraphNode[] = [
  { id: 'guide', label: '企业数字化转型指南', type: 'Document' },
  { id: 'plan', label: '数字化战略规划', type: 'Concept' },
  { id: 'arch', label: '技术架构设计', type: 'Concept' },
  { id: 'model', label: '数字化转型', type: 'Category' },
  { id: 'govern', label: '数据治理体系', type: 'Concept' },
  { id: 'workflow', label: '业务流程优化', type: 'Concept' },
  { id: 'doc1', label: '制造业转型案例.docx', type: 'Document' },
  { id: 'doc2', label: '技术选型方案.xlsx', type: 'Document' },
  { id: 'tag1', label: '组织管理', type: 'Tag' },
  { id: 'tag2', label: '流程优化', type: 'Tag' },
  { id: 'tag3', label: '战略规划', type: 'Tag' },
  { id: 'tag4', label: '业务创新', type: 'Tag' },
];

const fallbackEdges: GraphEdge[] = [
  { id: 'e1', source: 'guide', target: 'plan', label: '引用' },
  { id: 'e2', source: 'guide', target: 'arch', label: '包含' },
  { id: 'e3', source: 'guide', target: 'model', label: '属于' },
  { id: 'e4', source: 'guide', target: 'govern', label: '包含' },
  { id: 'e5', source: 'guide', target: 'workflow', label: '引用' },
  { id: 'e6', source: 'guide', target: 'doc1', label: '引用' },
  { id: 'e7', source: 'guide', target: 'doc2', label: '引用' },
  { id: 'e8', source: 'workflow', target: 'tag1', label: '关联' },
  { id: 'e9', source: 'workflow', target: 'tag2', label: '关联' },
  { id: 'e10', source: 'model', target: 'tag3', label: '关联' },
  { id: 'e11', source: 'model', target: 'tag4', label: '关联' },
];

const fallbackStats: GraphStats = {
  nodeCount: 1245,
  edgeCount: 3672,
  entityTypes: [],
  relationTypes: [],
};

const GraphOps: React.FC = () => {
  const [stats, setStats] = useState<GraphStats>(fallbackStats);
  const [nodes, setNodes] = useState<GraphNode[]>(fallbackNodes);
  const [edges, setEdges] = useState<GraphEdge[]>(fallbackEdges);

  useEffect(() => {
    getGraphStats()
      .then((res) => {
        const data = ((res as any)?.data ?? res) || {};
        setStats(data.nodeCount > 0 ? { ...fallbackStats, ...data } : fallbackStats);
      })
      .catch(() => setStats(fallbackStats));
    searchGraph('知识图谱')
      .then((res) => {
        const data = (res as any)?.data ?? res;
        if (data?.nodes?.length > 0) {
          setNodes(data.nodes);
          setEdges(data.edges ?? []);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <ModulePage activeKey="global" navItems={graphNav} title="知识图谱">
      <div className="rag-panel graph-filter">
        <Input prefix={<SearchOutlined />} placeholder="请输入关键词搜索图谱..." />
        <span>节点类型</span>
        <Select defaultValue="全部" options={[{ value: '全部' }]} />
        <span>业务分类</span>
        <Select defaultValue="全部" options={[{ value: '全部' }]} />
        <span>创建时间</span>
        <DatePicker.RangePicker />
        <Button>重置</Button>
        <Button type="primary">搜索</Button>
        <Button icon={<DownloadOutlined />}>导出图谱</Button>
      </div>
      <div className="graph-layout">
        <div className="rag-panel graph-canvas">
          <GraphVisualization edges={edges} height={620} nodes={nodes} />
          <div className="graph-legend">
            <span><i className="blue" />文档</span>
            <span><i className="green" />知识点</span>
            <span><i className="purple" />标签</span>
            <span><i className="orange" />业务分类</span>
            <span>— 关联</span>
            <span>→ 引用</span>
          </div>
          <div className="graph-controls">
            <Button icon={<FullscreenOutlined />} />
            <Button icon={<MinusOutlined />} />
            <span>100%</span>
            <Button icon={<PlusOutlined />} />
          </div>
        </div>
        <aside className="graph-side">
          <div className="rag-panel graph-stats">
            <h3>图谱数据统计</h3>
            <div>
              {[
                { label: '节点总数', value: stats.nodeCount, Icon: NodeIndexOutlined },
                { label: '关系总数', value: stats.edgeCount, Icon: NodeIndexOutlined },
                { label: '文档节点', value: 612, Icon: FileTextOutlined },
                { label: '知识点', value: 423, Icon: SearchOutlined },
                { label: '标签', value: 156, Icon: TagOutlined },
                { label: '业务分类', value: 54, Icon: FolderOutlined },
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
            <h3>热门知识点 Top 5</h3>
            {['数字化战略规划', '技术架构设计', '业务流程优化', '数据治理体系', '组织架构升级'].map((item, index) => (
              <p key={item}><b>{index + 1}</b>{item}<span>关联数：{362 - index * 38}</span></p>
            ))}
          </div>
          <div className="rag-panel graph-list">
            <h3>最近更新的节点</h3>
            {['制造业转型案例.docx', '技术选型方案.xlsx', '零售行业案例.pptx', '数字化转型白皮书.pdf'].map((item) => (
              <p key={item}><FileTextOutlined />{item}<span>2024-05-20</span></p>
            ))}
          </div>
        </aside>
      </div>
    </ModulePage>
  );
};

export default GraphOps;
