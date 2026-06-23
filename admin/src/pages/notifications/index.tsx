import { CheckOutlined } from '@ant-design/icons';
import { PageContainer, ProList } from '@ant-design/pro-components';
import { Badge, Button, message, Space, Tag } from 'antd';
import React, { useRef } from 'react';
import {
  deleteNotification,
  getNotifications,
  markAllAsRead,
  markAsRead,
  type Notification,
} from './service';

const typeMap: Record<string, { color: string; text: string }> = {
  system: { color: 'blue', text: '系统' },
  alert: { color: 'red', text: '告警' },
  info: { color: 'green', text: '信息' },
};

const Notifications: React.FC = () => {
  const actionRef = useRef<any>(undefined);

  return (
    <PageContainer>
      <ProList<Notification>
        headerTitle="通知列表"
        actionRef={actionRef}
        rowKey="id"
        toolBarRender={() => [
          <Button
            key="readAll"
            icon={<CheckOutlined />}
            onClick={async () => {
              await markAllAsRead();
              message.success('已全部标记为已读');
              actionRef.current?.reload();
            }}
          >
            全部已读
          </Button>,
        ]}
        request={async (params) => {
          const res = await getNotifications({
            current: params.current,
            pageSize: params.pageSize,
            type: params.type,
          });
          const data = (res as any)?.data ?? res;
          return {
            data: Array.isArray(data) ? data : (data?.list ?? []),
            total: (data as any)?.total ?? 0,
            success: true,
          };
        }}
        search={{ labelWidth: 'auto' }}
        metas={{
          title: {
            dataIndex: 'title',
            render: (_, record) => (
              <Space>
                {!record.read && <Badge status="processing" />}
                <span style={{ fontWeight: record.read ? 'normal' : 'bold' }}>
                  {record.title}
                </span>
              </Space>
            ),
          },
          description: {
            dataIndex: 'content',
            search: false,
          },
          subTitle: {
            dataIndex: 'type',
            render: (_, record) => {
              const t = typeMap[record.type];
              return t ? <Tag color={t.color}>{t.text}</Tag> : record.type;
            },
            valueEnum: Object.fromEntries(
              Object.entries(typeMap).map(([k, v]) => [k, { text: v.text }]),
            ),
          },
          actions: {
            render: (_, record) => [
              !record.read && (
                <Button
                  key="read"
                  type="link"
                  size="small"
                  onClick={async () => {
                    await markAsRead(record.id);
                    actionRef.current?.reload();
                  }}
                >
                  标记已读
                </Button>
              ),
              <Button
                key="delete"
                type="link"
                size="small"
                danger
                onClick={async () => {
                  await deleteNotification(record.id);
                  message.success('已删除');
                  actionRef.current?.reload();
                }}
              >
                删除
              </Button>,
            ],
          },
        }}
        pagination={{ defaultPageSize: 10 }}
      />
    </PageContainer>
  );
};

export default Notifications;
