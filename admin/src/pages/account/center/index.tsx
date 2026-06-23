import {
  ClockCircleOutlined,
  CommentOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import {
  Avatar,
  Card,
  Col,
  Descriptions,
  List,
  Row,
  Tag,
  Typography,
} from 'antd';
import React from 'react';

const { Text } = Typography;

const operationTabList = [
  { key: 'searches', label: '搜索历史' },
  { key: 'questions', label: '问答历史' },
  { key: 'operations', label: '操作记录' },
];

const mockSearches = [
  {
    id: '1',
    query: '如何优化RAG检索效果',
    mode: 'simple',
    time: '2026-06-24 10:30',
    hitCount: 12,
  },
  {
    id: '2',
    query: '向量数据库选型对比',
    mode: 'agentic',
    time: '2026-06-24 09:15',
    hitCount: 8,
  },
  {
    id: '3',
    query: '文档切分策略最佳实践',
    mode: 'auto',
    time: '2026-06-23 16:45',
    hitCount: 15,
  },
];

const mockQuestions = [
  {
    id: '1',
    question: 'RAG和微调有什么区别？',
    mode: 'simple',
    time: '2026-06-24 10:32',
    confidence: 0.92,
  },
  {
    id: '2',
    question: '如何提高检索准确率？',
    mode: 'agentic',
    time: '2026-06-24 09:18',
    confidence: 0.85,
  },
  {
    id: '3',
    question: '什么是混合检索？',
    mode: 'auto',
    time: '2026-06-23 16:50',
    confidence: 0.78,
  },
];

const mockOperations = [
  {
    id: '1',
    action: '上传文档',
    detail: 'RAG技术白皮书.pdf',
    time: '2026-06-24 10:00',
  },
  {
    id: '2',
    action: '删除文档',
    detail: '旧版接口说明.txt',
    time: '2026-06-23 15:30',
  },
  {
    id: '3',
    action: '修改配置',
    detail: '更新 Embedding 模型参数',
    time: '2026-06-23 14:00',
  },
];

const modeColorMap: Record<string, string> = {
  simple: 'blue',
  agentic: 'purple',
  auto: 'green',
};

const Center: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const currentUser = initialState?.currentUser;
  const [tabKey, setTabKey] = React.useState<string>('searches');

  const renderTabContent = () => {
    if (tabKey === 'searches') {
      return (
        <List
          dataSource={mockSearches}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={
                  <SearchOutlined style={{ fontSize: 20, color: '#1677ff' }} />
                }
                title={item.query}
                description={
                  <span>
                    <Tag color={modeColorMap[item.mode]}>{item.mode}</Tag>
                    命中 {item.hitCount} 条
                    <Text type="secondary" style={{ marginLeft: 12 }}>
                      <ClockCircleOutlined /> {item.time}
                    </Text>
                  </span>
                }
              />
            </List.Item>
          )}
        />
      );
    }
    if (tabKey === 'questions') {
      return (
        <List
          dataSource={mockQuestions}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={
                  <CommentOutlined style={{ fontSize: 20, color: '#722ed1' }} />
                }
                title={item.question}
                description={
                  <span>
                    <Tag color={modeColorMap[item.mode]}>{item.mode}</Tag>
                    置信度 {(item.confidence * 100).toFixed(0)}%
                    <Text type="secondary" style={{ marginLeft: 12 }}>
                      <ClockCircleOutlined /> {item.time}
                    </Text>
                  </span>
                }
              />
            </List.Item>
          )}
        />
      );
    }
    return (
      <List
        dataSource={mockOperations}
        renderItem={(item) => (
          <List.Item>
            <List.Item.Meta
              title={item.action}
              description={
                <span>
                  {item.detail}
                  <Text type="secondary" style={{ marginLeft: 12 }}>
                    <ClockCircleOutlined /> {item.time}
                  </Text>
                </span>
              }
            />
          </List.Item>
        )}
      />
    );
  };

  return (
    <PageContainer>
      <Row gutter={24}>
        <Col lg={7} md={24}>
          <Card variant="borderless">
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Avatar
                size={80}
                icon={<UserOutlined />}
                src={currentUser?.avatar}
              />
              <div style={{ marginTop: 12, fontSize: 20, fontWeight: 500 }}>
                {currentUser?.name ?? currentUser?.username ?? '用户'}
              </div>
              <Text type="secondary">{currentUser?.email ?? ''}</Text>
            </div>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="角色">
                {currentUser?.access === 'admin' ? (
                  <Tag color="red">管理员</Tag>
                ) : (
                  <Tag color="blue">普通用户</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="用户名">
                {currentUser?.username ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="邮箱">
                {currentUser?.email ?? '-'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col lg={17} md={24}>
          <Card
            variant="borderless"
            tabList={operationTabList}
            activeTabKey={tabKey}
            onTabChange={(key) => setTabKey(key)}
          >
            {renderTabContent()}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default Center;
