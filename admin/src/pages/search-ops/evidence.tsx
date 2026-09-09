import { ExperimentOutlined, SearchOutlined } from '@ant-design/icons';
import { ModulePage, searchNav } from '@/components/AdminShell';
import { Button, Card, Empty, Input, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import React, { useState } from 'react';
import { inspectRetrieval, type RetrievalCandidate, type RetrievalEvidenceResult } from './service';

const stageLabels: Record<string, string> = {
  keyword: 'BM25／ES 候选',
  vector: '向量候选',
  fused: 'RRF 合并',
  rerankInput: 'Rerank 输入',
  reranked: 'Rerank 结果',
  context: '最终上下文',
};

const columns = [
  { title: '排名', key: 'rank', width: 72, render: (_: unknown, _row: RetrievalCandidate, index: number) => index + 1 },
  { title: '文档', dataIndex: 'docId', key: 'docId', ellipsis: true, render: (docId: string) => <a href={`/documents/${encodeURIComponent(docId)}`}>{docId}</a> },
  { title: 'Chunk', dataIndex: 'chunkIndex', key: 'chunkIndex', width: 90 },
  { title: '分数', dataIndex: 'score', key: 'score', width: 110, render: (value: number) => value.toFixed(4) },
  { title: '来源', dataIndex: 'retrievalSource', key: 'source', width: 110, render: (value: string) => value ? <Tag>{value}</Tag> : '-' },
];

const EvidenceWorkbench: React.FC = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RetrievalEvidenceResult | null>(null);

  const run = async () => {
    if (!query.trim()) {
      message.warning('请输入要分析的 query');
      return;
    }
    setLoading(true);
    try {
      const response = await inspectRetrieval(query.trim());
      setResult((response as any)?.data ?? response);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '检索分析失败');
    } finally {
      setLoading(false);
    }
  };

  const stages = result?.candidates ?? {};
  const diagnostics = result?.diagnostics?.stages ?? {};
  return (
    <ModulePage activeKey="evidence" navItems={searchNav} title="检索证据实验台">
      <Card title={<Space><ExperimentOutlined />逐阶段查看一次检索的证据流</Space>}>
        <Space.Compact style={{ width: '100%', maxWidth: 820 }}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} onPressEnter={run} placeholder="输入 query，例如：2026 住宿报销上限是多少" />
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={run}>分析检索</Button>
        </Space.Compact>
      </Card>
      {!result ? <Empty description="输入 query 后查看 BM25、向量、RRF、Rerank 和最终上下文" style={{ marginTop: 80 }} /> : (
        <>
          <Card size="small" style={{ marginTop: 16 }}>
            <Space wrap>
              <Statistic title="向量通道" value={result.vectorSource || 'none'} />
              <Statistic title="Rerank" value={result.rerankApplied ? '已执行' : '未执行'} />
              <Statistic title="上下文字符" value={result.diagnostics?.contextCharacters ?? 0} />
              {Object.entries(diagnostics).map(([key, value]) => <Statistic key={key} title={stageLabels[key] || key} value={value} />)}
            </Space>
          </Card>
          {Object.entries(stages).map(([key, rows]) => (
            <Card key={key} title={`${stageLabels[key] || key}（${rows.length}）`} size="small" style={{ marginTop: 16 }}>
              <Table rowKey={(row) => `${row.id}-${row.chunkIndex}`} size="small" pagination={{ pageSize: 10 }} columns={columns} dataSource={rows} scroll={{ x: 720 }} />
            </Card>
          ))}
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            该页面展示候选元数据，不直接暴露完整语料；需要查看原文请进入对应文档详情。
          </Typography.Text>
        </>
      )}
    </ModulePage>
  );
};

export default EvidenceWorkbench;
