import {
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  KeyOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Button, List, Tag } from 'antd';
import React from 'react';

const apiData = [
  {
    title: 'LLM 服务',
    description: (
      <>
        <Tag color="success">已连接</Tag>
        通义千问 (qwen-plus) · OpenAI 兼容接口
      </>
    ),
    avatar: <ApiOutlined style={{ fontSize: 24, color: '#1677ff' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: '向量数据库',
    description: (
      <>
        <Tag color="success">已连接</Tag>
        Milvus · 19530 端口
      </>
    ),
    avatar: <DatabaseOutlined style={{ fontSize: 24, color: '#722ed1' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: '搜索引擎',
    description: (
      <>
        <Tag color="success">已连接</Tag>
        Elasticsearch · IK 中文分词
      </>
    ),
    avatar: <SearchOutlined style={{ fontSize: 24, color: '#13c2c2' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: 'Embedding 服务',
    description: (
      <>
        <Tag color="success">已连接</Tag>
        DashScope · text-embedding-v3
      </>
    ),
    avatar: <CloudServerOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
    actions: [<Button key="config">配置</Button>],
  },
  {
    title: 'Rerank 服务',
    description: (
      <>
        <Tag color="warning">未配置</Tag>
        DashScope Rerank · 需配置 API Key
      </>
    ),
    avatar: <KeyOutlined style={{ fontSize: 24, color: '#fa8c16' }} />,
    actions: [
      <Button key="config" type="primary">
        配置
      </Button>,
    ],
  },
];

const ApiView: React.FC = () => {
  return (
    <List
      itemLayout="horizontal"
      dataSource={apiData}
      renderItem={(item) => (
        <List.Item actions={item.actions}>
          <List.Item.Meta
            avatar={item.avatar}
            title={item.title}
            description={item.description}
          />
        </List.Item>
      )}
    />
  );
};

export default ApiView;
