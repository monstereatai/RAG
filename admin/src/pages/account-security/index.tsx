import {
  PageContainer,
  ProForm,
  ProFormText,
} from '@ant-design/pro-components';
import { Card, Descriptions, message, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import {
  changePassword,
  getSecurityInfo,
  type SecurityInfo,
  toggleTwoFactor,
} from './service';

const AccountSecurity: React.FC = () => {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSecurityInfo()
      .then((res) => setInfo((res as any)?.data ?? res ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loginColumns: ColumnsType<SecurityInfo['loginHistory'][0]> = [
    { title: 'IP', dataIndex: 'ip', width: 130 },
    { title: '设备', dataIndex: 'device', width: 200 },
    { title: '时间', dataIndex: 'time', width: 180 },
    {
      title: '状态',
      dataIndex: 'success',
      width: 80,
      render: (v: boolean) =>
        v ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>,
    },
  ];

  return (
    <PageContainer>
      <Card title="安全设置" style={{ marginBottom: 24 }} loading={loading}>
        <Descriptions column={1}>
          <Descriptions.Item label="上次修改密码">
            {info?.lastPasswordChange ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="两步验证">
            <Switch
              checked={info?.twoFactorEnabled ?? false}
              onChange={async (checked) => {
                await toggleTwoFactor(checked);
                setInfo((prev) =>
                  prev ? { ...prev, twoFactorEnabled: checked } : prev,
                );
                message.success(checked ? '已开启两步验证' : '已关闭两步验证');
              }}
            />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="修改密码" style={{ marginBottom: 24 }}>
        <ProForm
          style={{ maxWidth: 400 }}
          submitter={{ searchConfig: { submitText: '修改密码' } }}
          onFinish={async (values) => {
            await changePassword(values as any);
            message.success('密码修改成功');
            return true;
          }}
        >
          <ProFormText.Password
            name="oldPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          />
          <ProFormText.Password
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          />
          <ProFormText.Password
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({
                getFieldValue,
              }: {
                getFieldValue: (name: string) => string;
              }) => ({
                validator(_: unknown, value: string) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          />
        </ProForm>
      </Card>

      <Card title="登录历史">
        <Table
          rowKey="time"
          columns={loginColumns}
          dataSource={info?.loginHistory ?? []}
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </PageContainer>
  );
};

export default AccountSecurity;
