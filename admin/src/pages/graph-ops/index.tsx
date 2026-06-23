import { ApartmentOutlined, SearchOutlined } from '@ant-design/icons';
import { PageContainer, StatisticCard } from '@ant-design/pro-components';
import { Card, Col, Input, Row, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import GraphVisualization from './components/graph-visualization';
import {
  type GraphEdge,
  type GraphNode,
  type GraphStats,
  getGraphNodes,
  getGraphStats,
  searchGraph,
} from './service';

const { Title } = Typography;

const GraphOps: React.FC = () => {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);
  const [_searchKeyword, setSearchKeyword] = useState('');

  useEffect(() => {
    getGraphStats()
      .then((res) => setStats((res as any)?.data ?? res ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));

    getGraphNodes({ limit: 50 })
      .then((res) => setNodes((res as any)?.data ?? res ?? []))
      .catch(() => {});

    // Load graph visualization data
    setGraphLoading(true);
    searchGraph('知识图谱')
      .then((res) => {
        const data = (res as any)?.data ?? res;
        if (data) {
          setGraphNodes(data.nodes ?? []);
          setGraphEdges(data.edges ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setGraphLoading(false));
  }, []);

  const handleSearch = async (value: string) => {
    setSearchKeyword(value);
    if (!value.trim()) {
      const res = await getGraphNodes({ limit: 50 });
      setNodes((res as any)?.data ?? res ?? []);
      return;
    }
    const res = await getGraphNodes({ keyword: value, limit: 50 });
    setNodes((res as any)?.data ?? res ?? []);
  };

  const nodeColumns: ColumnsType<GraphNode> = [
    { title: 'ID', dataIndex: 'id', width: 200, ellipsis: true },
    { title: '标签', dataIndex: 'label', width: 150 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (type: string) => <Tag color="blue">{type}</Tag>,
    },
    {
      title: '属性',
      dataIndex: 'properties',
      width: 300,
      render: (props: Record<string, any>) =>
        props
          ? Object.entries(props)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          : '-',
    },
  ];

  return (
    <PageContainer>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '节点总数',
              value: stats?.nodeCount ?? 0,
              icon: <ApartmentOutlined style={{ fontSize: 24 }} />,
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '关系总数',
              value: stats?.edgeCount ?? 0,
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '实体类型数',
              value: stats?.entityTypes?.length ?? 0,
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '关系类型数',
              value: stats?.relationTypes?.length ?? 0,
            }}
          />
        </Col>
      </Row>

      {stats?.entityTypes && stats.entityTypes.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <Title level={5}>实体类型分布</Title>
          <Row gutter={[8, 8]}>
            {stats.entityTypes.map((et) => (
              <Col key={et.type}>
                <Tag color="blue">
                  {et.type}: {et.count}
                </Tag>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      <Card title="图谱可视化" style={{ marginBottom: 24 }}>
        <GraphVisualization
          nodes={graphNodes}
          edges={graphEdges}
          loading={graphLoading}
        />
      </Card>

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <Input.Search
            placeholder="搜索实体节点"
            allowClear
            enterButton={
              <>
                <SearchOutlined /> 搜索
              </>
            }
            onSearch={handleSearch}
            style={{ maxWidth: 400 }}
          />
        </div>
        <Table<GraphNode>
          rowKey="id"
          columns={nodeColumns}
          dataSource={nodes}
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </PageContainer>
  );
};

export default GraphOps;
