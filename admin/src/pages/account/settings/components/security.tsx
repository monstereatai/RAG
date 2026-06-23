import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Button, List, Modal, Tag, Typography } from 'antd';
import React, { useState } from 'react';

const { Text } = Typography;

const passwordStrength = {
  strong: { label: '强', color: 'success' },
  medium: { label: '中', color: 'warning' },
  weak: { label: '弱', color: 'error' },
};

const securityData = [
  {
    title: '账户密码',
    description: (
      <>
        当前密码强度：
        <Tag color={passwordStrength.strong.color}>
          {passwordStrength.strong.label}
        </Tag>
      </>
    ),
    actions: [<Button key="modify">修改</Button>],
  },
  {
    title: 'MFA 两步验证',
    description: '未绑定 MFA 设备，绑定后登录需二次确认',
    actions: [
      <Button key="bind" type="primary">
        绑定
      </Button>,
    ],
  },
  {
    title: '密保手机',
    description: '已绑定手机：138****8293',
    actions: [<Button key="modify">修改</Button>],
  },
  {
    title: '备用邮箱',
    description: '已绑定邮箱：ant***sign.com',
    actions: [<Button key="modify">修改</Button>],
  },
];

const mockLoginHistory = [
  {
    id: '1',
    ip: '192.168.1.100',
    location: '上海',
    device: 'Chrome / macOS',
    time: '2026-06-24 10:30',
    status: 'success',
  },
  {
    id: '2',
    ip: '10.0.0.55',
    location: '北京',
    device: 'Safari / iOS',
    time: '2026-06-23 18:20',
    status: 'success',
  },
  {
    id: '3',
    ip: '172.16.0.88',
    location: '未知',
    device: 'Firefox / Windows',
    time: '2026-06-22 09:10',
    status: 'failed',
  },
  {
    id: '4',
    ip: '192.168.1.100',
    location: '上海',
    device: 'Chrome / macOS',
    time: '2026-06-21 14:55',
    status: 'success',
  },
];

const SecurityView: React.FC = () => {
  const [loginHistoryVisible, setLoginHistoryVisible] = useState(false);

  return (
    <>
      <List
        itemLayout="horizontal"
        dataSource={securityData}
        renderItem={(item) => (
          <List.Item actions={item.actions}>
            <List.Item.Meta title={item.title} description={item.description} />
          </List.Item>
        )}
      />
      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <Button type="link" onClick={() => setLoginHistoryVisible(true)}>
          查看登录历史
        </Button>
      </div>
      <Modal
        title="登录历史"
        open={loginHistoryVisible}
        onCancel={() => setLoginHistoryVisible(false)}
        footer={null}
        width={640}
      >
        <List
          dataSource={mockLoginHistory}
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
