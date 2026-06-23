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
import { Button, Modal, message, Space, Tag } from 'antd';
import React, { useRef, useState } from 'react';
import {
  createPermission,
  deletePermission,
  getPermissions,
  type PermissionItem,
  updatePermission,
} from './service';

const moduleOptions = [
  { label: '文档管理', value: 'documents' },
  { label: '搜索运营', value: 'search-ops' },
  { label: '问答运营', value: 'qa-ops' },
  { label: '图谱运营', value: 'graph-ops' },
  { label: '用户管理', value: 'users' },
  { label: '角色管理', value: 'roles' },
  { label: '权限管理', value: 'permissions' },
  { label: '系统配置', value: 'system' },
  { label: '审计日志', value: 'audit' },
  { label: '通知中心', value: 'notifications' },
  { label: 'RAG 服务', value: 'rag' },
];

const moduleColorMap: Record<string, string> = {
  documents: 'blue',
  'search-ops': 'green',
  'qa-ops': 'purple',
  'graph-ops': 'cyan',
  users: 'orange',
  roles: 'gold',
  permissions: 'red',
  system: 'geekblue',
  audit: 'magenta',
  notifications: 'lime',
  rag: 'volcano',
};

const Permissions: React.FC = () => {
  const actionRef = useRef<any>(undefined);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentItem, setCurrentItem] = useState<PermissionItem | null>(null);

  const handleDelete = (record: PermissionItem) => {
    Modal.confirm({
      title: `确认删除权限「${record.name}」？`,
      okType: 'danger',
      onOk: async () => {
        await deletePermission(record.id);
        message.success('删除成功');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<PermissionItem>[] = [
    { title: '权限码', dataIndex: 'code', width: 200 },
    { title: '权限名', dataIndex: 'name', width: 150 },
    {
      title: '模块',
      dataIndex: 'module',
      width: 120,
      render: (_, record) => (
        <Tag color={moduleColorMap[record.module] || 'default'}>
          {moduleOptions.find((m) => m.value === record.module)?.label ??
            record.module}
        </Tag>
      ),
      valueEnum: Object.fromEntries(
        moduleOptions.map((m) => [m.value, m.label]),
      ),
    },
    { title: '描述', dataIndex: 'description', width: 200, search: false },
    {
      title: '操作',
      valueType: 'option',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setCurrentItem(record);
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
      <ProTable<PermissionItem>
        headerTitle="权限列表"
        actionRef={actionRef}
        rowKey="id"
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            新建权限
          </Button>,
        ]}
        request={async (params) => {
          const res = await getPermissions({
            current: params.current,
            pageSize: params.pageSize,
            module: params.module,
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
        title="新建权限"
        open={createModalVisible}
        onOpenChange={setCreateModalVisible}
        onFinish={async (values) => {
          await createPermission(values as any);
          message.success('创建成功');
          setCreateModalVisible(false);
          actionRef.current?.reload();
          return true;
        }}
      >
        <ProFormText
          name="code"
          label="权限码"
          tooltip="如 admin:documents:read"
          rules={[{ required: true, message: '请输入权限码' }]}
        />
        <ProFormText
          name="name"
          label="权限名"
          rules={[{ required: true, message: '请输入权限名' }]}
        />
        <ProFormSelect
          name="module"
          label="模块"
          options={moduleOptions}
          rules={[{ required: true, message: '请选择模块' }]}
        />
        <ProFormTextArea name="description" label="描述" />
      </ModalForm>

      <ModalForm
        title="编辑权限"
        open={editModalVisible}
        onOpenChange={(visible) => {
          setEditModalVisible(visible);
          if (!visible) setCurrentItem(null);
        }}
        initialValues={currentItem ?? {}}
        onFinish={async (values) => {
          if (currentItem) {
            await updatePermission(currentItem.id, values as any);
            message.success('更新成功');
            setEditModalVisible(false);
            setCurrentItem(null);
            actionRef.current?.reload();
          }
          return true;
        }}
      >
        <ProFormText name="name" label="权限名" />
        <ProFormTextArea name="description" label="描述" />
      </ModalForm>
    </PageContainer>
  );
};

export default Permissions;
