import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { ModulePage, systemNav } from '@/components/AdminShell';
import { Button, Checkbox, DatePicker, Input, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import { getUsers, type UserItem } from './service';

const fallbackUsers: UserItem[] = [
  ['10001', 'admin', '系统管理员', '技术部', '138****0001', 'admin@company.com', '系统管理员', 'active', '2024-01-15 09:30:21'],
  ['10002', 'zhangsan', '张三', '产品部', '138****0002', 'zhangsan@company.com', '产品经理', 'active', '2024-01-16 10:15:33'],
  ['10003', 'lisi', '李四', '研发部', '138****0003', 'lisi@company.com', '开发工程师', 'active', '2024-01-17 11:20:45'],
  ['10004', 'wangwu', '王五', '运营部', '138****0004', 'wangwu@company.com', '运营专员', 'inactive', '2024-01-18 14:25:12'],
  ['10005', 'zhaoliu', '赵六', '市场部', '138****0005', 'zhaoliu@company.com', '市场专员', 'active', '2024-01-19 15:30:18'],
  ['10006', 'sunqi', '孙七', '财务部', '138****0006', 'sunqi@company.com', '财务专员', 'active', '2024-01-20 16:40:22'],
  ['10007', 'zhouba', '周八', '人事部', '138****0007', 'zhouba@company.com', '人事专员', 'inactive', '2024-01-21 17:50:30'],
  ['10008', 'wujiu', '吴九', '技术部', '138****0008', 'wujiu@company.com', '开发工程师', 'active', '2024-01-22 18:55:40'],
  ['10009', 'liushi', '刘十', '产品部', '138****0009', 'liushi@company.com', '产品经理', 'active', '2024-01-23 19:05:50'],
  ['10010', 'chenyi', '陈一', '研发部', '138****0010', 'chenyi@company.com', '测试工程师', 'active', '2024-01-24 20:10:30'],
].map(([id, username, name, dept, phone, email, role, status, createdAt]) => ({
  id,
  username,
  name,
  department: dept,
  phone,
  email,
  status: status as UserItem['status'],
  roles: [{ id: role, name: role }],
  createdAt,
}));

type DisplayUser = UserItem & { name?: string; department?: string };

const Users: React.FC = () => {
  const [users, setUsers] = useState<DisplayUser[]>(fallbackUsers);

  useEffect(() => {
    getUsers({ current: 1, pageSize: 20 })
      .then((res) => {
        const data = (res as any)?.data ?? res;
        const list = Array.isArray(data) ? data : data?.items;
        if (Array.isArray(list) && list.length) setUsers(list);
      })
      .catch(() => setUsers(fallbackUsers));
  }, []);

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
      width: 160,
      render: (_, record) => (
        <Space>
          <Button type="link">编辑</Button>
          <Button type="link">{record.status === 'inactive' ? '启用' : '禁用'}</Button>
          <Button danger type="link">删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <ModulePage activeKey="users" navItems={systemNav} title="系统管理">
      <div className="rag-panel system-panel">
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
      </div>
    </ModulePage>
  );
};

export default Users;
