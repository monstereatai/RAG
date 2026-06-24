import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Checkbox, DatePicker, Input, Result, Select, Skeleton, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useState } from 'react';
import { getUsers, type UserItem } from './service';
import { ModulePage, systemNav } from '@/components/AdminShell';

type PageState = 'loading' | 'data' | 'error' | 'empty';

type DisplayUser = UserItem & { name?: string; department?: string };

const Users: React.FC = () => {
  const [users, setUsers] = useState<DisplayUser[]>([]);
  const [pageState, setPageState] = useState<PageState>('loading');

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
    </div></ModulePage>
  );
};

export default Users;
