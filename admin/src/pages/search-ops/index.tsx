import {
  PageContainer,
  type ProColumns,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { Col, Row, Tag } from 'antd';
import React, { useEffect, useState } from 'react';
import { getSearchRecords, getSearchStats, type SearchRecord } from './service';

const modeMap: Record<string, { color: string; text: string }> = {
  simple: { color: 'blue', text: 'Simple' },
  agentic: { color: 'purple', text: 'Agentic' },
  auto: { color: 'green', text: 'Auto' },
};

const SearchOps: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSearchStats()
      .then((res) => setStats((res as any)?.data ?? res ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns: ProColumns<SearchRecord>[] = [
    { title: '查询词', dataIndex: 'query', ellipsis: true, width: 250 },
    {
      title: '模式',
      dataIndex: 'mode',
      width: 100,
      render: (_, record) => {
        const m = modeMap[record.mode];
        return m ? <Tag color={m.color}>{m.text}</Tag> : record.mode;
      },
      valueEnum: Object.fromEntries(
        Object.entries(modeMap).map(([k, v]) => [k, { text: v.text }]),
      ),
    },
    {
      title: '命中数',
      dataIndex: 'hitCount',
      width: 80,
      search: false,
    },
    {
      title: '响应时间',
      dataIndex: 'responseTime',
      width: 100,
      search: false,
      render: (_, record) => `${record.responseTime}ms`,
    },
    { title: '用户', dataIndex: 'userId', width: 100 },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
  ];

  return (
    <PageContainer>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '总搜索次数',
              value: stats?.totalSearches ?? 0,
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '平均响应时间',
              value: stats?.avgResponseTime ?? 0,
              suffix: 'ms',
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '平均命中数',
              value: stats?.avgHitCount ?? 0,
              precision: 1,
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '零命中率',
              value: stats?.zeroHitRate ?? 0,
              suffix: '%',
              precision: 1,
            }}
          />
        </Col>
      </Row>

      <ProTable<SearchRecord>
        headerTitle="搜索记录"
        rowKey="id"
        request={async (params) => {
          const res = await getSearchRecords({
            current: params.current,
            pageSize: params.pageSize,
            query: params.query,
            mode: params.mode,
          });
          const data = (res as any)?.data ?? res;
          return {
            data: Array.isArray(data) ? data : (data?.list ?? []),
            total: (data as any)?.total ?? 0,
            success: true,
          };
        }}
        columns={columns}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 10 }}
      />
    </PageContainer>
  );
};

export default SearchOps;
