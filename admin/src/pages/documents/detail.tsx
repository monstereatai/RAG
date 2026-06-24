import {
  ArrowLeftOutlined,
  BookOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  FileTextOutlined,
  TagOutlined,
  UserOutlined,
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

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getDocumentDetail(id), getDocumentChunks(id)])
      .then(([docRes, chunkRes]) => {
        const docData = (docRes as any)?.data ?? docRes;
        setDoc(docData);
        const chunkData = (chunkRes as any)?.data ?? chunkRes;
        setChunks(
          Array.isArray(chunkData) ? chunkData : (chunkData?.list ?? []),
        );
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
