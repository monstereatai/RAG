import { CloudSyncOutlined, ReloadOutlined } from '@ant-design/icons';
import { ModulePage } from '@/components/AdminShell';
import type { SideNavItem } from '@/components/AdminShell';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Row,
  Space,
  Statistic,
  Switch,
  Tag,
  message,
} from 'antd';
import React, { useState } from 'react';
import {
  getFeishuWikiStatus,
  syncFeishuWiki,
  type FeishuWikiStatus,
  type FeishuWikiSyncResult,
} from './service';

const navItems: SideNavItem[] = [
  {
    key: 'sync',
    label: '空间同步',
    icon: <CloudSyncOutlined />,
    path: '/feishu-wiki',
  },
];

const unwrap = <T,>(response: any): T =>
  response?.data?.data ?? response?.data ?? response;

const formatTime = (value?: string | null) => {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const statusColor = (status?: string) => {
  if (status === 'completed' || status === 'success' || status === 'idle') return 'success';
  if (status === 'failed' || status === 'error') return 'error';
  return 'processing';
};

const FeishuWikiPage: React.FC = () => {
  const [spaceId, setSpaceId] = useState('');
  const [shareWithinTenant, setShareWithinTenant] = useState<boolean>();
  const [status, setStatus] = useState<FeishuWikiStatus>();
  const [syncResult, setSyncResult] = useState<FeishuWikiSyncResult>();
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const requireSpaceId = () => {
    const value = spaceId.trim();
    if (!value) {
      message.warning('请输入飞书 Wiki Space ID');
      return undefined;
    }
    return value;
  };

  const refreshStatus = async (requestedSpaceId?: string) => {
    const target = requestedSpaceId ?? requireSpaceId();
    if (!target) return;
    setStatusLoading(true);
    try {
      const result = unwrap<FeishuWikiStatus>(await getFeishuWikiStatus(target));
      setStatus(result);
      setShareWithinTenant(result.shareWithinTenant);
      setSpaceId(target);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '飞书 Wiki 状态查询失败');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleSync = async () => {
    const target = requireSpaceId();
    if (!target) return;
    setSyncing(true);
    try {
      const result = unwrap<FeishuWikiSyncResult>(await syncFeishuWiki(target, shareWithinTenant));
      setSyncResult(result);
      message.success(`飞书 Wiki 同步完成，发现 ${result.discovered} 项内容`);
      await refreshStatus(target);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '飞书 Wiki 同步失败');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ModulePage activeKey="sync" navItems={navItems} title="飞书 Wiki">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card title="知识空间同步">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 8 }}>飞书 Wiki Space ID</div>
                <Input
                  maxLength={256}
                  onChange={(event) => {
                    setSpaceId(event.target.value);
                    setShareWithinTenant(undefined);
                    setStatus(undefined);
                    setSyncResult(undefined);
                  }}
                  onPressEnter={() => void refreshStatus()}
                  placeholder="输入飞书知识空间 ID"
                  value={spaceId}
                />
              </div>
              <Space align="start">
                <Switch checked={shareWithinTenant ?? false} onChange={setShareWithinTenant} />
                <div>
                  <div>共享给本租户用户</div>
                  <div style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 12 }}>
                    关闭时仅当前管理员可访问；开启后仅允许当前管理员所属租户用户检索。
                  </div>
                </div>
              </Space>
              <Space wrap>
                <Button loading={syncing} onClick={handleSync} type="primary">
                  同步知识空间
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  loading={statusLoading}
                  onClick={() => void refreshStatus()}
                >
                  查询状态
                </Button>
              </Space>
              <Alert
                message="凭据由 RAG Backend 服务端读取"
                description="此页面不读取或保存飞书 App ID、App Secret 等凭据。RAG Backend 还需配置 FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS 才能启用连接器。共享默认关闭；开启共享时，服务端会从当前管理员账户读取租户归属并限制索引 ACL。"
                showIcon
                type="info"
              />
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={16}>
          <Card loading={statusLoading} title="同步状态">
            {status ? (
              <>
                <Descriptions bordered column={{ xs: 1, sm: 2 }} size="small">
                  <Descriptions.Item label="连接器 ID">{status.connectorId}</Descriptions.Item>
                  <Descriptions.Item label="Space ID">{status.spaceId}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={statusColor(status.status)}>{status.status}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="最近同步时间">{formatTime(status.lastSyncAt)}</Descriptions.Item>
                  <Descriptions.Item label="有效条目">{status.activeItems}</Descriptions.Item>
                  <Descriptions.Item label="已停用条目">{status.inactiveItems}</Descriptions.Item>
                  <Descriptions.Item label="租户共享">
                    <Tag color={status.shareWithinTenant ? 'blue' : 'default'}>
                      {status.shareWithinTenant ? '已开启' : '关闭'}
                    </Tag>
                  </Descriptions.Item>
                </Descriptions>
                {status.lastError && (
                  <Alert
                    message="最近同步错误"
                    description={status.lastError}
                    showIcon
                    style={{ marginTop: 16 }}
                    type="error"
                  />
                )}
              </>
            ) : (
              <Empty description="输入 Space ID 并查询同步状态" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
          <Card style={{ marginTop: 16 }} title="最近一次同步结果">
            {syncResult ? (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Tag color={statusColor(syncResult.status)}>{syncResult.status}</Tag>
                  <span>Space ID：{syncResult.spaceId}</span>
                </Space>
                <Row gutter={[16, 16]}>
                  <Col xs={12} sm={8} lg={6}><Statistic title="发现" value={syncResult.discovered} /></Col>
                  <Col xs={12} sm={8} lg={6}><Statistic title="新增" value={syncResult.imported} /></Col>
                  <Col xs={12} sm={8} lg={6}><Statistic title="更新" value={syncResult.updated} /></Col>
                  <Col xs={12} sm={8} lg={6}><Statistic title="未变化" value={syncResult.unchanged} /></Col>
                  <Col xs={12} sm={8} lg={6}><Statistic title="不支持而跳过" value={syncResult.skippedUnsupported} /></Col>
                  <Col xs={12} sm={8} lg={6}><Statistic title="停用" value={syncResult.deactivated} /></Col>
                </Row>
              </>
            ) : (
              <Empty description="尚未在本页面发起同步" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>
    </ModulePage>
  );
};

export default FeishuWikiPage;
