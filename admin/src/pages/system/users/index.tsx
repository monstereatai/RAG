import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Result,
  Select,
  Skeleton,
  Space,
  Spin,
  Table,
  Tag,
  Tree,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import React, { useCallback, useEffect, useState } from 'react';
import {
  getPermissionOptions,
  getUserDirectPermissions,
  getUsers,
  grantUserPermissions,
  revokeUserPermissions,
  type DirectPermissionItem,
  type PermissionOption,
  type UserItem,
} from './service';
import { ModulePage, systemNav } from '@/components/AdminShell';

type PageState = 'loading' | 'data' | 'error' | 'empty';

type DisplayUser = UserItem & { name?: string; department?: string };

/** 权限树节点 key 约定：分组节点用 `group:` 前缀，叶子节点用权限 ID */
const GROUP_KEY_PREFIX = 'group:';

const Users: React.FC = () => {
  const [users, setUsers] = useState<DisplayUser[]>([]);
  const [pageState, setPageState] = useState<PageState>('loading');

  // 「直接授权」弹窗状态
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUser, setGrantUser] = useState<DisplayUser | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantTreeData, setGrantTreeData] = useState<DataNode[]>([]);
  // initialKeys 记录打开时的直赋权限，保存时与其做差量（授予/撤销）
  const [grantInitialKeys, setGrantInitialKeys] = useState<number[]>([]);
  const [grantCheckedKeys, setGrantCheckedKeys] = useState<number[]>([]);

  const fetchUsers = useCallback(() => {
    setPageState('loading');
    getUsers({ current: 1, pageSize: 20 })
      .then((res) => {
        const data = (res as any)?.data ?? res;
        const list = Array.isArray(data) ? data : data?.items;
        if (Array.isArray(list) && list.length) {
          setUsers(list);
          setPageState('data');
        } else {
          setUsers([]);
          setPageState('empty');
        }
      })
      .catch(() => {
        setUsers([]);
        setPageState('error');
      });
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ===== 直接授权：权限树构建 + 勾选保存（授予/撤销差量提交） =====

  /** 把平铺权限列表按 code 中段（如 admin:documents:read -> documents）分组成树 */
  const buildPermissionTree = (permissions: PermissionOption[]): DataNode[] => {
    const groups = new Map<string, DataNode[]>();
    permissions.forEach((permission) => {
      const moduleKey = permission.code.split(':')[1] ?? 'other';
      const children = groups.get(moduleKey) ?? [];
      children.push({
        title: `${permission.name} (${permission.code})`,
        key: String(permission.id),
      });
      groups.set(moduleKey, children);
    });
    return Array.from(groups.entries()).map(([moduleKey, children]) => ({
      title: moduleKey,
      key: `${GROUP_KEY_PREFIX}${moduleKey}`,
      children,
    }));
  };

  const openGrantModal = async (record: DisplayUser) => {
    setGrantUser(record);
    setGrantOpen(true);
    setGrantLoading(true);
    setGrantTreeData([]);
    setGrantInitialKeys([]);
    setGrantCheckedKeys([]);
    try {
      // 并行拉取全量权限（建树）与该用户直赋权限（回显勾选）
      const [permissionRes, directRes] = await Promise.all([
        getPermissionOptions(),
        getUserDirectPermissions(record.id),
      ]);
      const permissionList: PermissionOption[] = ((permissionRes as any)?.data ??
        permissionRes ??
        []) as PermissionOption[];
      const directList: DirectPermissionItem[] = ((directRes as any)?.data ??
        directRes ??
        []) as DirectPermissionItem[];
      const directIds = directList.map((item) => Number(item.permissionId));
      setGrantTreeData(buildPermissionTree(permissionList));
      setGrantInitialKeys(directIds);
      setGrantCheckedKeys(directIds);
    } catch (e) {
      message.error('权限加载失败');
      setGrantOpen(false);
    } finally {
      setGrantLoading(false);
    }
  };

  const handleGrantCheck = (checked: any) => {
    const keys = Array.isArray(checked) ? checked : checked?.checked ?? [];
    // 只保留叶子节点（权限 ID），分组节点不参与保存
    setGrantCheckedKeys(
      keys
        .filter((key: any) => !String(key).startsWith(GROUP_KEY_PREFIX))
        .map((key: any) => Number(key)),
    );
  };

  const handleGrantSave = async () => {
    if (!grantUser) return;
    const toGrant = grantCheckedKeys.filter((id) => !grantInitialKeys.includes(id));
    const toRevoke = grantInitialKeys.filter((id) => !grantCheckedKeys.includes(id));
    if (toGrant.length === 0 && toRevoke.length === 0) {
      message.info('权限未发生变化');
      setGrantOpen(false);
      return;
    }
    setGrantSaving(true);
    try {
      if (toGrant.length > 0) {
        await grantUserPermissions(grantUser.id, toGrant);
      }
      if (toRevoke.length > 0) {
        await revokeUserPermissions(grantUser.id, toRevoke);
      }
      message.success('直接授权已保存，用户重新登录/刷新令牌后生效');
      setGrantOpen(false);
    } catch (e) {
      message.error('保存失败，请重试');
    } finally {
      setGrantSaving(false);
    }
  };

  const columns: ColumnsType<DisplayUser> = [
    { title: <Checkbox />, width: 48, render: () => <Checkbox /> },
    { title: '用户ID', dataIndex: 'id', width: 110 },
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '姓名', dataIndex: 'name', width: 120, render: (_, r) => r.name ?? r.username },
    { title: '所属部门', dataIndex: 'department', width: 130, render: (_, r) => r.department ?? '-' },
    { title: '手机号', dataIndex: 'phone', width: 140 },
    { title: '邮箱', dataIndex: 'email', width: 220 },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 150,
      render: (_, record) => <Tag color="blue">{record.roles?.[0]?.name ?? '用户'}</Tag>,
    },
    {
      title: '用户状态',
      dataIndex: 'status',
      width: 120,
      render: (value) => value === 'inactive' ? <Tag color="error">已禁用</Tag> : <Tag color="success">已启用</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '操作',
      width: 220,
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => openGrantModal(record)}>直接授权</Button>
          <Button type="link">编辑</Button>
          <Button danger type="link">删除</Button>
        </Space>
      ),
    },
  ];

  const renderBody = () => {
    switch (pageState) {
      case 'loading':
        return <Skeleton active paragraph={{ rows: 10 }} />;
      case 'error':
        return (
          <Result
            status="error"
            title="加载失败"
            subTitle="无法获取用户列表，请检查网络或联系管理员"
            extra={<Button icon={<ReloadOutlined />} onClick={fetchUsers}>重试</Button>}
          />
        );
      case 'empty':
        return (
          <Result
            status="info"
            title="暂无用户数据"
            subTitle="当前没有用户记录"
          />
        );
      case 'data':
      default:
        return (
          <>
            <div className="system-actions">
              <Button icon={<PlusOutlined />} type="primary">新增用户</Button>
              <Button>批量启用</Button>
              <Button>批量禁用</Button>
              <Button>批量删除</Button>
            </div>
            <div className="system-filters">
              <Input prefix={<SearchOutlined />} placeholder="请输入用户名/姓名/手机号" />
              <span>所属部门</span>
              <Select defaultValue="请选择" options={[{ value: '请选择' }]} />
              <span>用户状态</span>
              <Select defaultValue="请选择" options={[{ value: '请选择' }]} />
              <span>角色</span>
              <Select defaultValue="请选择" options={[{ value: '请选择' }]} />
              <span>创建时间</span>
              <DatePicker.RangePicker />
              <Button type="primary">查询</Button>
              <Button>重置</Button>
              <Button type="link">展开⌄</Button>
            </div>
            <Table columns={columns} dataSource={users} pagination={{ pageSize: 10, total: 120 }} rowKey="id" />
          </>
        );
    }
  };

  return (
    <ModulePage activeKey="users" navItems={systemNav} title="系统管理"><div className="rag-panel" style={{ padding: 24 }}>
      <div className="rag-panel system-panel">
        {renderBody()}
      </div>

      {/* 直接授权弹窗：勾选的权限写入 user_permissions（用户直赋权限） */}
      <Modal
        title={`直接授权 - ${grantUser?.username ?? ''}`}
        open={grantOpen}
        onOk={handleGrantSave}
        onCancel={() => setGrantOpen(false)}
        okText="保存"
        confirmLoading={grantSaving}
        width={520}
        destroyOnHidden
      >
        <p style={{ color: '#999', marginTop: 0 }}>
          仅维护「用户直赋权限」，最终生效权限 = 角色权限 ∪ 直赋权限
        </p>
        <Spin spinning={grantLoading}>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {!grantLoading && grantTreeData.length > 0 && (
              <Tree
                key={grantUser?.id ?? 'tree'}
                checkable
                defaultExpandAll
                onCheck={handleGrantCheck}
                treeData={grantTreeData}
              />
            )}
          </div>
        </Spin>
      </Modal>
    </div></ModulePage>
  );
};

export default Users;
