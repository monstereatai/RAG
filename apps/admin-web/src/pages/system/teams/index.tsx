import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  ModalForm,
  type ProColumns,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import { Button, Drawer, Form, Modal, Select, Space, Table, Tag, message } from 'antd';
import React, { useCallback, useRef, useState } from 'react';
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  type TeamItem,
  type TeamMemberItem,
  type UserOption,
  getTeamMembers,
  getTeams,
  getUserOptions,
  removeTeamMember,
  updateTeam,
} from './service';
import { ModulePage, systemNav } from '@/components/AdminShell';

const roleTag = (role: string) =>
  role === 'owner' ? <Tag color="gold">负责人</Tag> : <Tag color="blue">成员</Tag>;

const Teams: React.FC = () => {
  const actionRef = useRef<any>(undefined);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentTeam, setCurrentTeam] = useState<TeamItem | null>(null);

  // 成员管理抽屉
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [addForm] = Form.useForm();

  const loadMembers = useCallback(async (team: TeamItem) => {
    setMembersLoading(true);
    try {
      const res = await getTeamMembers(team.id);
      const data = (res as any)?.data ?? res ?? [];
      setMembers(Array.isArray(data) ? data : []);
    } catch (e) {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  const openMembers = async (team: TeamItem) => {
    setCurrentTeam(team);
    setMembersOpen(true);
    await loadMembers(team);
  };

  const openAddMember = async () => {
    addForm.resetFields();
    setAddMemberOpen(true);
    try {
      const res = await getUserOptions();
      const data = (res as any)?.data ?? res ?? [];
      setUserOptions(Array.isArray(data) ? data : []);
    } catch (e) {
      setUserOptions([]);
    }
  };

  const handleAddMember = async () => {
    if (!currentTeam) return;
    const values = await addForm.validateFields();
    await addTeamMember(currentTeam.id, {
      userId: Number(values.userId),
      role: values.role ?? 'member',
    });
    message.success('成员已添加');
    setAddMemberOpen(false);
    await loadMembers(currentTeam);
    actionRef.current?.reload();
  };

  const handleRemoveMember = (member: TeamMemberItem) => {
    if (!currentTeam) return;
    Modal.confirm({
      title: `确认将「${member.username}」移出团队？`,
      okType: 'danger',
      onOk: async () => {
        await removeTeamMember(currentTeam.id, member.userId);
        message.success('已移除');
        await loadMembers(currentTeam);
        actionRef.current?.reload();
      },
    });
  };

  const handleDelete = (record: TeamItem) => {
    Modal.confirm({
      title: `确认删除团队「${record.name}」？`,
      content: `该团队有 ${record.memberCount} 名成员，删除后成员关系一并移除`,
      okType: 'danger',
      onOk: async () => {
        await deleteTeam(record.id);
        message.success('删除成功');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<TeamItem>[] = [
    { title: '团队名称', dataIndex: 'name', width: 180 },
    { title: '描述', dataIndex: 'description', width: 240, search: false, ellipsis: true },
    {
      title: '成员数',
      dataIndex: 'memberCount',
      width: 90,
      search: false,
      render: (_, record) => record.memberCount ?? 0,
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
      width: 220,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<TeamOutlined />}
            onClick={() => openMembers(record)}
          >
            成员
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setCurrentTeam(record);
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

  const memberColumns = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '邮箱', dataIndex: 'email', width: 200, ellipsis: true },
    { title: '团队角色', dataIndex: 'role', width: 100, render: (role: string) => roleTag(role) },
    {
      title: '操作',
      width: 80,
      render: (_: any, record: TeamMemberItem) => (
        <Button danger type="link" size="small" onClick={() => handleRemoveMember(record)}>
          移除
        </Button>
      ),
    },
  ];

  return (
    <ModulePage activeKey="teams" navItems={systemNav} title="系统管理">
      <div className="rag-panel" style={{ padding: 24 }}>
        <ProTable<TeamItem>
          headerTitle="团队/部门"
          actionRef={actionRef}
          rowKey="id"
          toolBarRender={() => [
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              新建团队
            </Button>,
          ]}
          request={async (params) => {
            const res = await getTeams({
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
          title="新建团队"
          open={createModalVisible}
          onOpenChange={setCreateModalVisible}
          onFinish={async (values) => {
            await createTeam(values as any);
            message.success('创建成功');
            setCreateModalVisible(false);
            actionRef.current?.reload();
            return true;
          }}
        >
          <ProFormText
            name="name"
            label="团队名称"
            rules={[{ required: true, message: '请输入团队名称' }]}
          />
          <ProFormTextArea name="description" label="描述" />
        </ModalForm>

        <ModalForm
          title="编辑团队"
          open={editModalVisible}
          onOpenChange={(visible) => {
            setEditModalVisible(visible);
            if (!visible) setCurrentTeam(null);
          }}
          initialValues={
            currentTeam
              ? { name: currentTeam.name, description: currentTeam.description ?? undefined }
              : {}
          }
          onFinish={async (values) => {
            if (currentTeam) {
              await updateTeam(currentTeam.id, values as any);
              message.success('更新成功');
              setEditModalVisible(false);
              setCurrentTeam(null);
              actionRef.current?.reload();
            }
            return true;
          }}
        >
          <ProFormText
            name="name"
            label="团队名称"
            rules={[{ required: true, message: '请输入团队名称' }]}
          />
          <ProFormTextArea name="description" label="描述" />
        </ModalForm>

        <Drawer
          title={`成员管理 - ${currentTeam?.name ?? ''}`}
          open={membersOpen}
          width={640}
          onClose={() => {
            setMembersOpen(false);
            setCurrentTeam(null);
            setMembers([]);
          }}
          extra={
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAddMember}>
              添加成员
            </Button>
          }
        >
          <Table
            columns={memberColumns}
            dataSource={members}
            rowKey={(record) => `${record.userId}`}
            loading={membersLoading}
            pagination={false}
            size="small"
          />
        </Drawer>

        <Modal
          title={`添加成员 - ${currentTeam?.name ?? ''}`}
          open={addMemberOpen}
          onOk={handleAddMember}
          onCancel={() => setAddMemberOpen(false)}
          destroyOnHidden
        >
          <Form form={addForm} layout="vertical">
            <Form.Item
              name="userId"
              label="用户"
              rules={[{ required: true, message: '请选择用户' }]}
            >
              <Select
                placeholder="请选择用户"
                showSearch
                optionFilterProp="label"
                options={userOptions.map((user) => ({
                  label: `${user.username}${user.email ? ` (${user.email})` : ''}`,
                  value: user.id,
                }))}
              />
            </Form.Item>
            <Form.Item name="role" label="团队角色" initialValue="member">
              <Select
                options={[
                  { label: '成员', value: 'member' },
                  { label: '负责人', value: 'owner' },
                ]}
              />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </ModulePage>
  );
};

export default Teams;
