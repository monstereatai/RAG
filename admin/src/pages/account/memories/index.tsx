import { ModulePage, accountNav } from '@/components/AdminShell';
import type { MemoriesResponse, MemoryItem } from './service';
import { getMemories, clearMemories } from './service';
import { Button, Card, Empty, List, Modal, Space, Tag, Typography, message } from 'antd';
import { DeleteOutlined, ReloadOutlined, DatabaseOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';

const { Text, Paragraph } = Typography;

type PageState = 'loading' | 'data' | 'error' | 'empty' | 'disabled';

const MemoryManagement: React.FC = () => {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [clearing, setClearing] = useState(false);

  const loadMemories = () => {
    setPageState('loading');
    getMemories()
      .then((data: MemoriesResponse) => {
        if (!data.enabled) {
          setPageState('disabled');
          return;
        }
        if (!data.memories || data.memories.length === 0) {
          setPageState('empty');
          return;
        }
        setMemories(data.memories);
        setPageState('data');
      })
      .catch(() => {
        setPageState('error');
      });
  };

  useEffect(() => {
    loadMemories();
  }, []);

  const handleClear = () => {
    Modal.confirm({
      title: '确认清空长期记忆',
      content: '此操作将删除你所有的长期记忆数据（如身份信息、偏好、历史事实）。此操作不可撤销。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setClearing(true);
        try {
          await clearMemories();
          message.success('长期记忆已清空');
          setMemories([]);
          setPageState('empty');
        } catch {
          message.error('清空失败，请稍后重试');
        } finally {
          setClearing(false);
        }
      },
    });
  };

  if (pageState === 'loading') {
    return (
      <ModulePage activeKey="memories" navItems={accountNav} title="长期记忆">
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center', color: '#999' }}>
          加载中...
        </div>
      </ModulePage>
    );
  }

  if (pageState === 'disabled') {
    return (
      <ModulePage activeKey="memories" navItems={accountNav} title="长期记忆">
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center' }}>
          <DatabaseOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
          <p style={{ marginTop: 16, color: '#999' }}>
            长期记忆服务未启用。配置 Mem0 Provider 后即可使用。
          </p>
        </div>
      </ModulePage>
    );
  }

  if (pageState === 'empty') {
    return (
      <ModulePage activeKey="memories" navItems={accountNav} title="长期记忆">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadMemories}>刷新</Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleClear} loading={clearing}>
              清空所有记忆
            </Button>
          </Space>
        </div>
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center' }}>
          <Empty description="暂无长期记忆数据" />
          <Text type="secondary">与 AI 对话后，有价值的记忆会自动保存到这里。</Text>
        </div>
      </ModulePage>
    );
  }

  if (pageState === 'error') {
    return (
      <ModulePage activeKey="memories" navItems={accountNav} title="长期记忆">
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center', color: '#ff4d4f' }}>
          <p>加载失败，请稍后重试</p>
          <Button type="primary" onClick={loadMemories}>重试</Button>
        </div>
      </ModulePage>
    );
  }

  return (
    <ModulePage activeKey="memories" navItems={accountNav} title="长期记忆">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text type="secondary">共 {memories.length} 条记忆</Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadMemories}>刷新</Button>
          <Button danger icon={<DeleteOutlined />} onClick={handleClear} loading={clearing}>
            清空所有记忆
          </Button>
        </Space>
      </div>

      <Card>
        <List
          dataSource={memories}
          renderItem={(item: MemoryItem, index: number) => (
            <List.Item
              actions={[
                item.score !== undefined && (
                  <Tag color="blue" key="score">
                    相关度: {(item.score * 100).toFixed(0)}%
                  </Tag>
                ),
              ].filter(Boolean)}
            >
              <List.Item.Meta
                title={
                  <Space size={4}>
                    <Tag color="purple">#{index + 1}</Tag>
                    {item.category && <Tag>{item.category}</Tag>}
                  </Space>
                }
                description={
                  <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: '展开' }} style={{ marginBottom: 0 }}>
                    {item.memory}
                  </Paragraph>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </ModulePage>
  );
};

export default MemoryManagement;
