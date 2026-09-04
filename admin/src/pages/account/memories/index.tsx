import { ModulePage, accountNav } from '@/components/AdminShell';
import type { MemoriesResponse, MemoryItem } from './service';
import { getMemories, clearMemories } from './service';
import {
  Button,
  Card,
  Empty,
  List,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  ReloadOutlined,
  DatabaseOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import React, { useEffect, useState } from 'react';

const { Text, Paragraph } = Typography;

const memoryPageTitle = (
  <Space size={6} align="center">
    <span>长期记忆</span>
    <Tooltip
      placement="right"
      title={
        <div>
          <div>每轮对话结束后，系统会自动判断是否需要记录。</div>
          <div>会记录：跨会话仍有价值的身份、长期偏好和长期约束。</div>
          <div>不会记录：寒暄、一次性任务、纯确认和未采纳的助手建议。</div>
          <div>此页面只展示跨会话的长期记忆。</div>
        </div>
      }
    >
      <Button
        aria-label="长期记忆记录规则"
        icon={<QuestionCircleOutlined />}
        size="small"
        style={{
          color: '#8c8c8c',
          cursor: 'help',
          fontSize: 14,
          minWidth: 14,
          padding: 0,
        }}
        type="text"
      />
    </Tooltip>
  </Space>
);

type PageState = 'loading' | 'data' | 'error' | 'empty' | 'disabled';

/**
 * 兼容 Admin Backend → RAG Backend 的统一响应包装；任何异常结构都安全降级为空，
 * 防止页面把包装对象当数组处理后触发运行时错误。
 */
const unwrapMemoriesResponse = (response: unknown): MemoriesResponse => {
  let value = response;
  while (value && typeof value === 'object' && 'data' in value) {
    value = (value as { data?: unknown }).data;
  }
  const payload = value as Partial<MemoriesResponse> | undefined;
  return {
    enabled: payload?.enabled === true,
    memories: Array.isArray(payload?.memories) ? payload.memories : [],
  };
};

const MemoryManagement: React.FC = () => {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [clearing, setClearing] = useState(false);

  /** 读取结果明确区分服务未启用、空记忆、接口失败，避免将三种状态混成「暂无数据」。 */
  const loadMemories = () => {
    setPageState('loading');
    getMemories()
      .then((response: MemoriesResponse) => {
        const data = unwrapMemoriesResponse(response);
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

  /** 清空是不可逆操作，必须经二次确认；成功后本地状态同步为空而不是重新猜测接口结果。 */
  const handleClear = () => {
    Modal.confirm({
      title: '确认清空长期记忆',
      content:
        '此操作将删除你所有的长期记忆数据（如身份信息、偏好、历史事实）。此操作不可撤销。',
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
      <ModulePage
        activeKey="memories"
        navItems={accountNav}
        title={memoryPageTitle}
      >
        <div
          className="rag-panel"
          style={{ padding: 40, textAlign: 'center', color: '#999' }}
        >
          加载中...
        </div>
      </ModulePage>
    );
  }

  if (pageState === 'disabled') {
    return (
      <ModulePage
        activeKey="memories"
        navItems={accountNav}
        title={memoryPageTitle}
      >
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
      <ModulePage
        activeKey="memories"
        navItems={accountNav}
        title={memoryPageTitle}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 16,
          }}
        >
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadMemories}>
              刷新
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleClear}
              loading={clearing}
            >
              清空所有记忆
            </Button>
          </Space>
        </div>
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center' }}>
          <Empty description="暂无长期记忆数据" />
          <Text type="secondary">
            与 AI 对话后，有价值的记忆会自动保存到这里。
          </Text>
        </div>
      </ModulePage>
    );
  }

  if (pageState === 'error') {
    return (
      <ModulePage
        activeKey="memories"
        navItems={accountNav}
        title={memoryPageTitle}
      >
        <div
          className="rag-panel"
          style={{ padding: 40, textAlign: 'center', color: '#ff4d4f' }}
        >
          <p>加载失败，请稍后重试</p>
          <Button type="primary" onClick={loadMemories}>
            重试
          </Button>
        </div>
      </ModulePage>
    );
  }

  return (
    <ModulePage
      activeKey="memories"
      navItems={accountNav}
      title={memoryPageTitle}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Text type="secondary">共 {memories.length} 条记忆</Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadMemories}>
            刷新
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleClear}
            loading={clearing}
          >
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
                  <Paragraph
                    ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                    style={{ marginBottom: 0 }}
                  >
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
