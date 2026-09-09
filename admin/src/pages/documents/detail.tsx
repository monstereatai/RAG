import {
  ArrowLeftOutlined,
  BookOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  FileTextOutlined,
  TagOutlined,
  UserOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { ModulePage, documentNav } from '@/components/AdminShell';
import { history, useParams } from '@umijs/max';
import {
  Button,
  Card,
  Col,
  Descriptions,
  message,
  Row,
  Spin,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useState } from 'react';
import {
  type ChunkItem,
  type DocumentItem,
  getDocumentChunks,
  getDocumentDetail,
  reprocessDocument,
} from './service';

const { Paragraph, Text } = Typography;

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待处理' },
  processing: { color: 'processing', text: '处理中' },
  completed: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
};

const DocumentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getDocumentDetail(id), getDocumentChunks(id)])
      .then(([docRes, chunkRes]) => {
        const rawDoc = (docRes as any)?.data ?? docRes;
        const docData = {
          ...rawDoc,
          id: rawDoc.id ?? rawDoc.docId ?? id,
          fileType: rawDoc.fileType ?? 'text',
          fileSize: rawDoc.fileSize ?? 0,
          uploadedBy: rawDoc.uploadedBy ?? rawDoc.userId ?? '未知',
          updatedAt: rawDoc.updatedAt ?? rawDoc.createdAt,
          metadata: rawDoc.metadata ?? {
            title: rawDoc.title,
            author: rawDoc.author,
            summary: rawDoc.summary,
            keywords: rawDoc.keywords,
            language: rawDoc.language,
            category: rawDoc.category,
          },
        };
        setDoc(docData);
        const rawChunks = (chunkRes as any)?.data ?? chunkRes;
        const chunkData = (Array.isArray(rawChunks) ? rawChunks : rawChunks?.list ?? []).map(
          (chunk: any) => ({
            ...chunk,
            index: chunk.index ?? chunk.chunkIndex ?? 0,
            headingPath: Array.isArray(chunk.headingPath)
              ? chunk.headingPath.join(' / ')
              : chunk.headingPath ?? '',
            tokenCount: chunk.tokenCount ?? Math.ceil((chunk.content?.length ?? 0) / 4),
            startOffset: chunk.startOffset ?? chunk.sourceStart ?? 0,
            endOffset: chunk.endOffset ?? chunk.sourceEnd ?? chunk.content?.length ?? 0,
          }),
        );
        setChunks(chunkData);
      })
      .catch(() => message.error('加载文档详情失败'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <ModulePage activeKey="mine" navItems={documentNav} title="文档详情">
        <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />
      </ModulePage>
    );
  }

  if (!doc) {
    return (
      <ModulePage activeKey="mine" navItems={documentNav} title="文档详情">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => history.push('/documents')}
        >
          返回文档列表
        </Button>
        <div style={{ textAlign: 'center', marginTop: 100 }}>文档不存在</div>
      </ModulePage>
    );
  }

  const statusKey = doc.status ?? 'pending';
  const status = statusMap[statusKey] ?? { color: 'default', text: '未知' };
  const meta = doc.metadata;
  const pipeline = doc.indexPipeline;
  const pipelineStatus: Record<string, { text: string; color: string }> = {
    indexed: { text: '已完成', color: 'green' },
    pending: { text: '处理中', color: 'gold' },
    failed: { text: '失败', color: 'red' },
    skipped: { text: '未启用', color: 'default' },
  };
  const retry = async () => {
    setRetrying(true);
    try {
      await reprocessDocument(doc.id);
      message.success('已提交重新处理任务');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重试失败');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <ModulePage activeKey="mine" navItems={documentNav} title="文档详情">
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Card title="文档信息" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="状态">
                <Tag color={status.color}>{status.text}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="类型">
                {doc.fileType.toUpperCase()}
              </Descriptions.Item>
              <Descriptions.Item label="大小">
                {(doc.fileSize / 1024).toFixed(1)} KB
              </Descriptions.Item>
              <Descriptions.Item label="分块数">
                {doc.chunkCount}
              </Descriptions.Item>
              <Descriptions.Item label="上传者">
                <UserOutlined /> {doc.uploadedBy}
              </Descriptions.Item>
              <Descriptions.Item label="上传时间">
                <ClockCircleOutlined />{' '}
                {new Date(doc.createdAt).toLocaleString()}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {meta && (
            <Card title="元数据" size="small" style={{ marginTop: 16 }}>
              <Descriptions column={1} size="small">
                {meta.title && (
                  <Descriptions.Item label="标题">
                    <FileTextOutlined /> {meta.title}
                  </Descriptions.Item>
                )}
                {meta.author && (
                  <Descriptions.Item label="作者">
                    <UserOutlined /> {meta.author}
                  </Descriptions.Item>
                )}
                {meta.category && (
                  <Descriptions.Item label="分类">
                    <BookOutlined /> {meta.category}
                  </Descriptions.Item>
                )}
                {meta.language && (
                  <Descriptions.Item label="语言">
                    {meta.language}
                  </Descriptions.Item>
                )}
                {meta.keywords && meta.keywords.length > 0 && (
                  <Descriptions.Item label="关键词">
                    {meta.keywords.map((kw: string) => (
                      <Tag key={kw} icon={<TagOutlined />}>
                        {kw}
                      </Tag>
                    ))}
                  </Descriptions.Item>
                )}
              </Descriptions>
              {meta.summary && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">摘要</Text>
                  <Paragraph style={{ marginTop: 4 }}>{meta.summary}</Paragraph>
                </div>
              )}
            </Card>
          )}
          {pipeline && (
            <Card title="三路发布状态" size="small" style={{ marginTop: 16 }} extra={<Button size="small" icon={<ReloadOutlined />} loading={retrying} onClick={retry}>重试发布</Button>}>
              {Object.entries({ rag: 'RAG 向量', es: 'ES 搜索', graph: 'Neo4j 图谱' }).map(([key, label]) => {
                const item = pipeline[key as keyof typeof pipeline];
                const state = pipelineStatus[item.status] ?? pipelineStatus.pending;
                return <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}><span>{label}</span><span><Tag color={state.color}>{state.text}</Tag>{item.chunkCount !== null && <Text type="secondary">{item.chunkCount} chunks</Text>}<Text type="secondary" style={{ display: 'block', fontSize: 12 }}>耗时：{item.durationMs === null ? '暂无记录' : `${item.durationMs} ms`}</Text>{item.error && <Typography.Text type="danger" style={{ display: 'block', fontSize: 12 }}>{item.error}</Typography.Text>}</span></div>;
              })}
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>版本：{doc.docVersion || '未标注'}；索引耗时由发布任务持久化后展示。</Text>
            </Card>
          )}
        </Col>

        <Col xs={24} lg={16}>
          <Card
            title={
              <span>
                <CodeOutlined /> 分块预览
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                  共 {doc.chunkCount} 个分块
                </Text>
              </span>
            }
            size="small"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {chunks.map((chunk) => (
                <Card
                  key={chunk.id}
                  size="small"
                  type="inner"
                  title={
                    <span style={{ fontSize: 13 }}>
                      分块 #{chunk.index}
                      <Text type="secondary" style={{ marginLeft: 8 }}>
                        {chunk.headingPath}
                      </Text>
                    </span>
                  }
                  extra={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {chunk.tokenCount} tokens
                    </Text>
                  }
                >
                  <Paragraph
                    ellipsis={{ rows: 3, expandable: 'collapsible' }}
                    style={{ marginBottom: 0, fontSize: 13 }}
                  >
                    {chunk.content}
                  </Paragraph>
                </Card>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
    </ModulePage>
  );
};

export default DocumentDetail;
