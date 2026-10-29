import { List, Switch } from 'antd';
import React from 'react';

type Unpacked<T> = T extends (infer U)[] ? U : T;

const notificationAction = (key: string, defaultChecked = true) => (
  <Switch
    key={key}
    checkedChildren="开"
    unCheckedChildren="关"
    defaultChecked={defaultChecked}
  />
);

const notificationData = [
  {
    key: 'doc-process',
    title: '文档处理通知',
    description: '文档上传、切分、索引完成或失败时通知',
    actions: [notificationAction('doc-process-switch')],
  },
  {
    key: 'search-alert',
    title: '检索异常告警',
    description: '检索超时、命中率异常下降时告警',
    actions: [notificationAction('search-alert-switch', false)],
  },
  {
    key: 'system-update',
    title: '系统更新通知',
    description: '系统配置变更、服务升级时通知',
    actions: [notificationAction('system-update-switch')],
  },
  {
    key: 'user-action',
    title: '用户操作通知',
    description: '新用户注册、权限变更时通知',
    actions: [notificationAction('user-action-switch', false)],
  },
];

const NotificationView: React.FC = () => {
  const data = notificationData;
  return (
    <List<Unpacked<typeof data>>
      rowKey="key"
      itemLayout="horizontal"
      dataSource={data}
      renderItem={(item) => (
        <List.Item actions={item.actions}>
          <List.Item.Meta title={item.title} description={item.description} />
        </List.Item>
      )}
    />
  );
};

export default NotificationView;
