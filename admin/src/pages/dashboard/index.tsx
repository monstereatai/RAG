import {
  CommentOutlined,
  FileTextOutlined,
  RiseOutlined,
  SearchOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Line } from '@ant-design/plots';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Col, Row, Segmented, Statistic, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import {
  type DashboardStats,
  getDashboardStats,
  getTrendData,
  type TrendItem,
} from './service';

const { Title } = Typography;

const mockTrendData: TrendItem[] = Array.from({ length: 14 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (13 - i));
  const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
  return {
    date: dateStr,
    searchCount: Math.floor(Math.random() * 80) + 20,
    qaCount: Math.floor(Math.random() * 60) + 10,
    documentCount: Math.floor(Math.random() * 10) + 1,
  };
});

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trendData, setTrendData] = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendRange, setTrendRange] = useState<string>('14天');

  useEffect(() => {
    getDashboardStats()
      .then((res) => setStats((res as any)?.data ?? res ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const days = trendRange === '7天' ? 7 : trendRange === '30天' ? 30 : 14;
    getTrendData({ days })
      .then((res) => {
        const data = (res as any)?.data ?? res;
        setTrendData(
          Array.isArray(data) && data.length > 0 ? data : mockTrendData,
        );
      })
      .catch(() => setTrendData(mockTrendData));
  }, [trendRange]);

  const items = [
    {
      title: '文档总数',
      value: stats?.documentCount ?? 0,
      icon: <FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />,
    },
    {
      title: '搜索次数',
      value: stats?.searchCount ?? 0,
      icon: <SearchOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
    },
    {
      title: '问答次数',
      value: stats?.qaCount ?? 0,
      icon: <CommentOutlined style={{ fontSize: 24, color: '#722ed1' }} />,
    },
    {
      title: '用户总数',
      value: stats?.userCount ?? 0,
      icon: <TeamOutlined style={{ fontSize: 24, color: '#fa8c16' }} />,
    },
    {
      title: '今日搜索',
      value: stats?.todaySearchCount ?? 0,
      icon: <RiseOutlined style={{ fontSize: 24, color: '#13c2c2' }} />,
    },
    {
      title: '今日问答',
      value: stats?.todayQaCount ?? 0,
      icon: <ThunderboltOutlined style={{ fontSize: 24, color: '#eb2f96' }} />,
    },
  ];

  const lineData = trendData.flatMap((item) => [
    { date: item.date, value: item.searchCount, type: '搜索次数' },
    { date: item.date, value: item.qaCount, type: '问答次数' },
    { date: item.date, value: item.documentCount, type: '新增文档' },
  ]);

  const lineConfig = {
    data: lineData,
    xField: 'date',
    yField: 'value',
    colorField: 'type',
    smooth: true,
    height: 320,
    yAxis: { min: 0 },
    legend: { position: 'top' as const },
  };

  return (
    <PageContainer>
      <Row gutter={[16, 16]}>
        {items.map((item) => (
          <Col xs={24} sm={12} md={8} lg={8} xl={4} key={item.title}>
            <Card loading={loading} hoverable>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {item.icon}
                <Statistic title={item.title} value={item.value} />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        style={{ marginTop: 24 }}
        title="趋势概览"
        extra={
          <Segmented
            options={['7天', '14天', '30天']}
            value={trendRange}
            onChange={(v) => setTrendRange(v as string)}
          />
        }
      >
        <Line {...lineConfig} />
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} md={12}>
          <Card loading={loading}>
            <Title level={5}>检索命中率</Title>
            <Statistic
              title="平均命中率"
              value={stats?.hitRate ?? 0}
              suffix="%"
              precision={1}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card loading={loading}>
            <Title level={5}>响应性能</Title>
            <Statistic
              title="平均响应时间"
              value={stats?.avgResponseTime ?? 0}
              suffix="ms"
              precision={0}
            />
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default Dashboard;
