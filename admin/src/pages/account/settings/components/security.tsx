import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { request } from '@umijs/max';
import { Button, List, Modal, Spin, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const { Text } = Typography;

interface SecurityItem {
  title: string;
  description: React.ReactNode;
  actions: React.ReactNode[];
}

interface LoginRecord {
  id: string;
  ip: string;
  location: string;
  device: string;
  time: string;
  status: 'success' | 'failed';
}

const SecurityView: React.FC = () => {
  const [securityItems, setSecurityItems] = useState<SecurityItem[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginRecord[]>([]);
  const [loginHistoryVisible, setLoginHistoryVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 尝试从后端获取安全设置数据
    Promise.allSettled([
      request('/api/admin/account/security').catch(() => null),
      request('/api/admin/account-security/mfa').catch(() => null),
    ])
      .then(([securityRes, mfaRes]) => {
        const items: SecurityItem[] = [];

        if (securityRes.status === 'fulfilled' && securityRes.value) {
          const data = securityRes.value as Record<string, unknown>;
          // 使用真实接口数据
          items.push({
            title: '账户密码',
            description: (
              <>
                当前密码强度：
                <Tag
                  color={
                    data.passwordStrength === 'weak'
                      ? 'error'
                      : data.passwordStrength === 'medium'
                        ? 'warning'
                        : 'success'
                  }
                >
                  {data.passwordStrength === 'weak'
                    ? '弱'
                    : data.passwordStrength === 'medium'
                      ? '中'
                      : '强'}
                </Tag>
              </>
            ),
            actions: [<Button key="modify">修改</Button>],
          });
        } else {
          // 后端接口不可用，展示空状态占位
          items.push({
            title: '账户密码',
            description: (
              <>
                <Tag color="default">未接入</Tag>
                <Text type="secondary">
                  （安全设置接口暂未对接，请联系管理员）
                </Text>
              </>
            ),
            actions: [],
          });
        }

        if (mfaRes.status === 'fulfilled' && mfaRes.value) {
          const data = mfaRes.value as Record<string, unknown>;
          items.push({
            title: 'MFA 两步验证',
            description: data.enabled ? '已绑定 MFA 设备' : '未绑定 MFA 设备',
            actions: [
              <Button key="bind" type="primary">
                {data.enabled ? '解绑' : '绑定'}
              </Button>,
            ],
          });
        } else {
          items.push({
            title: 'MFA 两步验证',
            description: (
              <>
                <Tag color="default">未接入</Tag>
                <Text type="secondary">
                  （安全设置接口暂未对接，请联系管理员）
                </Text>
              </>
            ),
            actions: [],
          });
        }

        // 安全设置接口无用户联系方式数据，留空状态
        items.push({
          title: '密保手机',
          description: (
            <>
              <Tag color="default">未接入</Tag>
              <Text type="secondary">（密保手机接口暂未提供）</Text>
            </>
          ),
          actions: [],
        });

        items.push({
          title: '备用邮箱',
          description: (
            <>
              <Tag color="default">未接入</Tag>
              <Text type="secondary">（备用邮箱接口暂未提供）</Text>
            </>
          ),
          actions: [],
        });

        setSecurityItems(items);
      })
      .finally(() => setLoading(false));

    // 尝试获取登录历史
    request('/api/admin/account-security/login-attempts')
      .then((data: unknown) => {
        const records = data as LoginRecord[];
        if (Array.isArray(records) && records.length > 0) {
          setLoginHistory(records);
        }
      })
      .catch(() => {
        // 接口不可用，保持空列表
      });
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin tip="正在加载安全设置..." />
      </div>
    );
  }

  return (
    <>
      <List
        itemLayout="horizontal"
        dataSource={securityItems}
        renderItem={(item) => (
          <List.Item actions={item.actions}>
            <List.Item.Meta title={item.title} description={item.description} />
          </List.Item>
        )}
      />
      {loginHistory.length > 0 && (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Button type="link" onClick={() => setLoginHistoryVisible(true)}>
            查看登录历史
          </Button>
        </div>
      )}
      <Modal
        title="登录历史"
        open={loginHistoryVisible}
        onCancel={() => setLoginHistoryVisible(false)}
        footer={null}
        width={640}
      >
        <List
          dataSource={loginHistory}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={
                  item.status === 'success' ? (
                    <CheckCircleOutlined
                      style={{ fontSize: 20, color: '#52c41a' }}
                    />
                  ) : (
                    <ExclamationCircleOutlined
                      style={{ fontSize: 20, color: '#ff4d4f' }}
                    />
                  )
                }
                title={
                  <span>
                    {item.ip}
                    <Tag
                      color={item.status === 'success' ? 'success' : 'error'}
                      style={{ marginLeft: 8 }}
                    >
                      {item.status === 'success' ? '成功' : '失败'}
                    </Tag>
                  </span>
                }
                description={
                  <span>
                    {item.location} · {item.device}
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      {item.time}
                    </Text>
                  </span>
                }
              />
            </List.Item>
          )}
        />
      </Modal>
    </>
  );
};

export default SecurityView;
