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
import { Button, DatePicker, Input, Select, Skeleton } from 'antd';
import React, { useEffect, useState } from 'react';
import GraphVisualization from './components/graph-visualization';
import { getGraphStats, searchGraph, type GraphEdge, type GraphNode, type GraphStats } from './service';

type GraphState = 'loading' | 'data' | 'empty' | 'disabled' | 'error';

const GraphOps: React.FC = () => {
  const [graphState, setGraphState] = useState<GraphState>('loading');
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);

  useEffect(() => {
    setGraphState('loading');

    Promise.all([
      getGraphStats(),
      searchGraph('知识图谱'),
    ])
      .then(([statsRes, searchRes]) => {
        const statsData = ((statsRes as any)?.data ?? statsRes) || {};

        // Check if Neo4j is disabled (503 response or disabled flag)
        if (statsData.statusCode === 503 || statsData.disabled || statsData.message?.includes('disabled')) {
          setGraphState('disabled');
          return;
        }

        if (statsData.nodeCount > 0) {
          setStats(statsData);
        }

        const searchData = (searchRes as any)?.data ?? searchRes;
        if (searchData?.nodes?.length > 0) {
          setNodes(searchData.nodes);
          setEdges(searchData.edges ?? []);
        }

        if (statsData?.nodeCount > 0 || (searchData?.nodes?.length ?? 0) > 0) {
          setGraphState('data');
        } else {
          setGraphState('empty');
        }
      })
      .catch((err) => {
        const errMsg = (err as any)?.message ?? '';
        if (errMsg.includes('disabled') || errMsg.includes('503') || errMsg.includes('GraphRAG')) {
          setGraphState('disabled');
        } else {
          setGraphState('error');
        }
      });
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

      {graphState === 'disabled' && (
        <div className="rag-panel" style={{ textAlign: 'center', padding: '80px 0' }}>
          <h3>知识图谱未启用</h3>
          <p style={{ color: '#999', margin: '12px 0 8px' }}>
            Neo4j 知识图谱功能当前未启用。如需使用，请在 rag-backend 设置
            <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>
              GRAPH_RAG_ENABLED=true
            </code>
            并确保 Neo4j 服务正在运行。
          </p>
        </div>
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
        <div className="rag-panel" style={{ textAlign: 'center', padding: '80px 0' }}>
          <h3>图谱为空</h3>
          <p style={{ color: '#999', marginTop: 8 }}>知识图谱尚未生成，请先上传文档并执行实体关系抽取。</p>
        </div>
      )}

      {graphState === 'error' && (
        <div className="rag-panel" style={{ textAlign: 'center', padding: '80px 0' }}>
          <h3>加载失败</h3>
          <p style={{ color: '#999', margin: '12px 0 24px' }}>
            无法加载图谱数据，请确认 Neo4j 和 rag-backend 服务正常运行。
          </p>
          <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()} type="primary">
            重新加载
          </Button>
        </div>
      )}

      {graphState === 'data' && (
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
                  { label: '节点总数', value: stats?.nodeCount ?? 0, Icon: NodeIndexOutlined },
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
                  <span style={{ color: '#999', fontSize: 12 }}> ({node.type})</span>
                </p>
              ))}
            </div>
          </aside>
        </div>
      )}
    </ModulePage>
  );
};

export default GraphOps;
