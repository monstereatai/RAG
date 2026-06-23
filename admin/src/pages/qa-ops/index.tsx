import {
  PageContainer,
  type ProColumns,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { Col, Row, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import { getQaRecords, getQaStats, type QaRecord } from './service';

const { Paragraph } = Typography;

const modeMap: Record<string, { color: string; text: string }> = {
  simple: { color: 'blue', text: 'Simple' },
  agentic: { color: 'purple', text: 'Agentic' },
  auto: { color: 'green', text: 'Auto' },
};

const QaOps: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getQaStats()
      .then((res) => setStats((res as any)?.data ?? res ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns: ProColumns<QaRecord>[] = [
    {
      title: '问题',
      dataIndex: 'question',
      ellipsis: true,
      width: 200,
    },
    {
      title: '回答',
      dataIndex: 'answer',
      width: 250,
      search: false,
      render: (_, record) => (
        <Paragraph ellipsis={{ rows: 2 }}>{record.answer}</Paragraph>
      ),
    },
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
      title: '置信度',
      dataIndex: 'confidence',
      width: 100,
      search: false,
      render: (_, record) => (
        <span>{(record.confidence * 100).toFixed(1)}%</span>
      ),
    },
    {
      title: '反馈',
      dataIndex: 'feedback',
      width: 80,
      valueEnum: {
        positive: { text: '好评', status: 'Success' },
        negative: { text: '差评', status: 'Error' },
      },
    },
    { title: '来源数', dataIndex: 'sourcesCount', width: 80, search: false },
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
            statistic={{ title: '总问答数', value: stats?.totalQa ?? 0 }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '平均置信度',
              value: ((stats?.avgConfidence ?? 0) * 100).toFixed(1),
              suffix: '%',
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '好评率',
              value: ((stats?.positiveRate ?? 0) * 100).toFixed(1),
              suffix: '%',
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '差评率',
              value: ((stats?.negativeRate ?? 0) * 100).toFixed(1),
              suffix: '%',
            }}
          />
        </Col>
      </Row>

      <ProTable<QaRecord>
        headerTitle="问答记录"
        rowKey="id"
        request={async (params) => {
          const res = await getQaRecords({
            current: params.current,
            pageSize: params.pageSize,
            question: params.question,
            mode: params.mode,
            feedback: params.feedback,
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

export default QaOps;
