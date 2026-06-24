import { EyeInvisibleOutlined } from '@ant-design/icons';
import { ModulePage, accountNav } from '@/components/AdminShell';
import { useModel } from '@umijs/max';
import { Avatar, Button, DatePicker, Form, Input, Select, Table, Tag } from 'antd';
import { getProfile } from './service';
import type { ProfileData } from './service';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';

type PageState = 'loading' | 'data' | 'error' | 'empty';

const AccountCenter: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const user = initialState?.currentUser;
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');

  useEffect(() => {
    setPageState('loading');
    getProfile()
      .then((data) => {
        if (!data) {
          setPageState('empty');
          return;
        }
        setProfile(data);
        setPageState('data');
      })
      .catch(() => setPageState('error'));
  }, []);

  const columns: ColumnsType<{ time: string; ip: string; location: string; device: string; type: string }> = [
    { title: '登录时间', dataIndex: 'time' },
    { title: '登录IP', dataIndex: 'ip' },
    { title: '登录地点', dataIndex: 'location' },
    { title: '登录设备', dataIndex: 'device' },
    { title: '登录方式', dataIndex: 'type' },
  ];

  if (pageState === 'loading') {
    return (
      <ModulePage activeKey="profile" navItems={accountNav} title="个人中心">
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center', color: '#999' }}>
          加载中...
        </div>
      </ModulePage>
    );
  }

  if (pageState === 'error') {
    return (
      <ModulePage activeKey="profile" navItems={accountNav} title="个人中心">
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center', color: '#ff4d4f' }}>
          加载失败，请稍后重试
        </div>
      </ModulePage>
    );
  }

  if (pageState === 'empty') {
    return (
      <ModulePage activeKey="profile" navItems={accountNav} title="个人中心">
        <div className="rag-panel" style={{ padding: 40, textAlign: 'center', color: '#999' }}>
          暂无个人资料
        </div>
      </ModulePage>
    );
  }

  return (
    <ModulePage activeKey="profile" navItems={accountNav} title="个人中心">
      <div className="account-grid">
        <section className="rag-panel account-profile">
          <h3>个人信息</h3>
          <div className="profile-body">
            <div>
              <Avatar size={138} src={profile!.avatar || user?.avatar} />
              <Button>更换头像</Button>
            </div>
            <dl>
              <dt>用户名</dt><dd>{profile!.username}</dd>
              <dt>真实姓名</dt><dd>{profile!.name}</dd>
              <dt>所属部门</dt><dd>{profile!.department}</dd>
              <dt>职位</dt><dd>{profile!.position}</dd>
              <dt>手机</dt><dd>{profile!.phone}</dd>
              <dt>邮箱</dt><dd>{profile!.email}</dd>
              <dt>用户状态</dt><dd><Tag color="success">正常</Tag></dd>
              <dt>创建时间</dt><dd>{profile!.createdAt}</dd>
              <dt>更新时间</dt><dd>{profile!.updatedAt}</dd>
            </dl>
          </div>
        </section>
        <section className="rag-panel password-panel">
          <h3>密码修改</h3>
          <Form labelCol={{ span: 4 }}>
            <Form.Item label="当前密码" required><Input.Password iconRender={() => <EyeInvisibleOutlined />} placeholder="请输入当前密码" /></Form.Item>
            <Form.Item label="新密码" required><Input.Password iconRender={() => <EyeInvisibleOutlined />} placeholder="请输入新密码" /></Form.Item>
            <Form.Item label="密码强度"><Select defaultValue="弱" options={[{ value: '弱' }, { value: '中' }, { value: '强' }]} /></Form.Item>
            <Form.Item label="确认新密码" required><Input.Password iconRender={() => <EyeInvisibleOutlined />} placeholder="请再次输入新密码" /></Form.Item>
            <Button type="primary">确认修改</Button>
          </Form>
        </section>
        <section className="rag-panel login-records">
          <h3>登录记录</h3>
          <div className="filter-line">
            <DatePicker.RangePicker />
            <span>登录IP</span>
            <Input placeholder="请输入登录IP" />
            <Button type="primary">查询</Button>
            <Button>重置</Button>
          </div>
          <Table columns={columns} dataSource={[]} pagination={{ pageSize: 10 }} rowKey="id" />
        </section>
        <section className="rag-panel permission-panel">
          <h3>个人权限</h3>
          <Table
            columns={[
              { title: '权限模块', dataIndex: 'module', width: 120 },
              { title: '权限说明', dataIndex: 'desc' },
            ]}
            dataSource={[]}
            pagination={false}
            rowKey="module"
          />
        </section>
      </div>
    </ModulePage>
  );
};

export default AccountCenter;
