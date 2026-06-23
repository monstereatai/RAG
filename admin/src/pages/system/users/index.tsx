import {
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  ModalForm,
  PageContainer,
  type ProColumns,
  ProFormSelect,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import { Button, Modal, message, Space, Tag } from 'antd';
import React, { useRef, useState } from 'react';
import {
  createUser,
  deleteUser,
  getUsers,
  resetPassword,
  type UserItem,
  updateUser,
} from './service';

const statusMap: Record<string, { color: string; text: string }> = {
  active: { color: 'success', text: '正常' },
  inactive: { color: 'default', text: '停用' },
  locked: { color: 'error', text: '锁定' },
};

const Users: React.FC = () => {
  const actionRef = useRef<any>(undefined);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserItem | null>(null);

  const handleDelete = (record: UserItem) => {
    Modal.confirm({
      title: `确认删除用户「${record.username}」？`,
      okType: 'danger',
      onOk: async () => {
        await deleteUser(record.id);
        message.success('删除成功');
        actionRef.current?.reload();
      },
    });
  };

  const handleResetPassword = (record: UserItem) => {
    Modal.confirm({
      title: `重置用户「${record.username}」的密码？`,
      content: '密码将重置为默认密码',
      onOk: async () => {
        await resetPassword(record.id, 'Admin@123456');
        message.success('密码已重置');
      },
    });
  };

  const columns: ProColumns<UserItem>[] = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '邮箱', dataIndex: 'email', width: 200, search: false },
    { title: '手机号', dataIndex: 'phone', width: 130, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      valueEnum: Object.fromEntries(
        Object.entries(statusMap).map(([k, v]) => [
          k,
          {
            text: v.text,
            status:
              v.color === 'success'
                ? 'Success'
                : v.color === 'error'
                  ? 'Error'
                  : 'Default',
          },
        ]),
      ),
    },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 150,
      search: false,
      render: (_, record) =>
        record.roles?.map((r) => <Tag key={r.id}>{r.name}</Tag>),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setCurrentUser(record);
              setEditModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<KeyOutlined />}
            onClick={() => handleResetPassword(record)}
          >
            重置密码
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<UserItem>
        headerTitle="用户列表"
        actionRef={actionRef}
        rowKey="id"
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            新建用户
          </Button>,
        ]}
        request={async (params) => {
          const res = await getUsers({
            current: params.current,
            pageSize: params.pageSize,
            username: params.username,
            status: params.status,
          });
          const data = (res as any)?.data ?? res;
          return {
            data: Array.isArray(data) ? data : (data?.list ?? []),
            total: (data as any)?.total ?? 0,
            success: true,
          };
        }}
        columns={columns}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 10 }}
      />

      <ModalForm
        title="新建用户"
        open={createModalVisible}
        onOpenChange={setCreateModalVisible}
        onFinish={async (values) => {
          await createUser(values as any);
          message.success('创建成功');
          setCreateModalVisible(false);
          actionRef.current?.reload();
          return true;
        }}
      >
        <ProFormText
          name="username"
          label="用户名"
          rules={[{ required: true, message: '请输入用户名' }]}
        />
        <ProFormText.Password
          name="password"
          label="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        />
        <ProFormText
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        />
        <ProFormText name="phone" label="手机号" />
      </ModalForm>

      <ModalForm
        title="编辑用户"
        open={editModalVisible}
        onOpenChange={(visible) => {
          setEditModalVisible(visible);
          if (!visible) setCurrentUser(null);
        }}
        initialValues={currentUser ?? {}}
        onFinish={async (values) => {
          if (currentUser) {
            await updateUser(currentUser.id, values as any);
            message.success('更新成功');
            setEditModalVisible(false);
            setCurrentUser(null);
            actionRef.current?.reload();
          }
          return true;
        }}
      >
        <ProFormText name="email" label="邮箱" />
        <ProFormText name="phone" label="手机号" />
        <ProFormSelect
          name="status"
          label="状态"
          options={[
            { label: '正常', value: 'active' },
            { label: '停用', value: 'inactive' },
            { label: '锁定', value: 'locked' },
          ]}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default Users;
