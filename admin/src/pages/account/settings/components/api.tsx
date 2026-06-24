import {
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  KeyOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { request } from '@umijs/max';
import { Button, List, Spin, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const { Text } = Typography;

interface ServiceItem {
  title: string;
  avatar: React.ReactNode;
  actions: React.ReactNode[];
}

const serviceDefinitions: ServiceItem[] = [
  {
    title: 'LLM 服务',
    avatar: <ApiOutlined style={{ fontSize: 24, color: '#1677ff' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: '向量数据库',
    avatar: <DatabaseOutlined style={{ fontSize: 24, color: '#722ed1' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: '搜索引擎',
    avatar: <SearchOutlined style={{ fontSize: 24, color: '#13c2c2' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: 'Embedding 服务',
    avatar: <CloudServerOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: 'Rerank 服务',
    avatar: <KeyOutlined style={{ fontSize: 24, color: '#fa8c16' }} />,
    actions: [
      <Button key="config" type="primary">
        配置
      </Button>,
    ],
  },
];

const ApiView: React.FC = () => {
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request('/api/health')
      .then(() => setBackendAvailable(true))
      .catch(() => setBackendAvailable(false))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin tip="正在检测服务状态..." />
      </div>
    );
  }

  return (
    <List
      itemLayout="horizontal"
      dataSource={serviceDefinitions}
      renderItem={(item) => (
        <List.Item actions={item.actions}>
          <List.Item.Meta
            avatar={item.avatar}
            title={item.title}
            description={
              backendAvailable ? (
                <>
                  <Tag color="default">暂未接入</Tag>
                  <Text type="secondary">
                    （Demo 展示 — 服务状态接口尚未对接）
                  </Text>
                </>
              ) : (
                <>
                  <Tag color="error">未连接</Tag>
                  <Text type="secondary">（后端服务不可达，无法获取状态）</Text>
                </>
              )
            }
          />
        </List.Item>
      )}
    />
  );
};

export default ApiView;
