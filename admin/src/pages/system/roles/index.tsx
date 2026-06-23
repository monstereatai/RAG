import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  ModalForm,
  PageContainer,
  type ProColumns,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import { Button, Modal, message, Space } from 'antd';
import React, { useRef, useState } from 'react';
import {
  createRole,
  deleteRole,
  getPermissions,
  getRoles,
  type RoleItem,
  updateRole,
} from './service';

const Roles: React.FC = () => {
  const actionRef = useRef<any>(undefined);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentRole, setCurrentRole] = useState<RoleItem | null>(null);
  const [permissionOptions, setPermissionOptions] = useState<
    { label: string; value: string }[]
  >([]);

  const loadPermissions = async () => {
    const res = await getPermissions();
    const data = (res as any)?.data ?? res ?? [];
    setPermissionOptions(
      (Array.isArray(data) ? data : []).map((p: any) => ({
        label: p.name,
        value: p.id,
      })),
    );
  };

  const handleDelete = (record: RoleItem) => {
    Modal.confirm({
      title: `确认删除角色「${record.name}」？`,
      content: `该角色下有 ${record.userCount} 个用户`,
      okType: 'danger',
      onOk: async () => {
        await deleteRole(record.id);
        message.success('删除成功');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<RoleItem>[] = [
    { title: '角色名', dataIndex: 'name', width: 150 },
    { title: '描述', dataIndex: 'description', width: 200, search: false },
    {
      title: '权限数',
      dataIndex: 'permissions',
      width: 80,
      search: false,
      render: (_, record) => record.permissions?.length ?? 0,
    },
    {
      title: '用户数',
      dataIndex: 'userCount',
      width: 80,
      search: false,
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
      width: 150,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={async () => {
              await loadPermissions();
              setCurrentRole(record);
              setEditModalVisible(true);
            }}
          >
            编辑
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
      <ProTable<RoleItem>
        headerTitle="角色列表"
        actionRef={actionRef}
        rowKey="id"
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={async () => {
              await loadPermissions();
              setCreateModalVisible(true);
            }}
          >
            新建角色
          </Button>,
        ]}
        request={async (params) => {
          const res = await getRoles({
            current: params.current,
            pageSize: params.pageSize,
            name: params.name,
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
        title="新建角色"
        open={createModalVisible}
        onOpenChange={setCreateModalVisible}
        onFinish={async (values) => {
          await createRole(values as any);
          message.success('创建成功');
          setCreateModalVisible(false);
          actionRef.current?.reload();
          return true;
        }}
      >
        <ProFormText
          name="name"
          label="角色名"
          rules={[{ required: true, message: '请输入角色名' }]}
        />
        <ProFormTextArea name="description" label="描述" />
        <ProFormSelect
          name="permissionIds"
          label="权限"
          mode="multiple"
          options={permissionOptions}
        />
      </ModalForm>

      <ModalForm
        title="编辑角色"
        open={editModalVisible}
        onOpenChange={(visible) => {
          setEditModalVisible(visible);
          if (!visible) setCurrentRole(null);
        }}
        initialValues={
          currentRole
            ? {
                name: currentRole.name,
                description: currentRole.description,
                permissionIds: currentRole.permissions?.map((p) => p.id),
              }
            : {}
        }
        onFinish={async (values) => {
          if (currentRole) {
            await updateRole(currentRole.id, values as any);
            message.success('更新成功');
            setEditModalVisible(false);
            setCurrentRole(null);
            actionRef.current?.reload();
          }
          return true;
        }}
      >
        <ProFormText name="name" label="角色名" />
        <ProFormTextArea name="description" label="描述" />
        <ProFormSelect
          name="permissionIds"
          label="权限"
          mode="multiple"
          options={permissionOptions}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default Roles;
