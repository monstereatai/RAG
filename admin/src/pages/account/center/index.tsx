import { EyeInvisibleOutlined } from '@ant-design/icons';
import { ModulePage, accountNav } from '@/components/AdminShell';
import { useModel } from '@umijs/max';
import { Avatar, Button, DatePicker, Form, Input, Select, Table, Tag } from 'antd';
import { getProfile } from './service';
import type { ProfileData } from './service';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';

const loginRecords = [
  ['2024-05-20 14:22:33', '192.168.1.100', '中国 · 北京', 'Chrome 124.0 / Windows', '账号密码'],
  ['2024-05-20 09:15:47', '192.168.1.100', '中国 · 北京', 'Chrome 124.0 / Windows', '账号密码'],
  ['2024-05-19 18:33:21', '192.168.1.101', '中国 · 北京', 'Edge 124.0 / Windows', '账号密码'],
  ['2024-05-19 10:05:12', '10.0.0.25', '中国 · 上海', 'Chrome 124.0 / MacOS', '账号密码'],
  ['2024-05-18 16:44:09', '192.168.1.102', '中国 · 深圳', 'Chrome 124.0 / Windows', '账号密码'],
].map(([time, ip, location, device, type], id) => ({ id, time, ip, location, device, type }));

const permissions = [
  ['文档管理', '查看、新建、编辑、删除文档及文档分类管理'],
  ['智能搜索', '使用全局搜索功能，查看搜索结果'],
  ['AI智能问答', '使用AI问答功能，获取智能问答回复'],
  ['知识图谱', '查看知识图谱，探索关联知识'],
  ['系统管理', '查看系统配置信息（无修改权限）'],
  ['个人中心', '查看及修改个人信息、密码，查看登录记录'],
].map(([module, desc]) => ({ module, desc }));

const AccountCenter: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const user = initialState?.currentUser;
  const [profile, setProfile] = useState<ProfileData>({
    department: '产品研发部',
    position: '产品经理',
    phone: '138****5678',
    createdAt: '2023-06-15 09:30:21',
    updatedAt: '2024-05-20 14:22:33',
    name: user?.name ?? '张三',
    email: user?.email ?? 'zhangsan@company.com',
    username: user?.username ?? 'zhangsan',
    avatar: user?.avatar,
  });

  useEffect(() => {
    getProfile()
      .then((data) => setProfile((prev) => ({ ...prev, ...data })))
      .catch(() => {});
  }, []);

  const columns: ColumnsType<(typeof loginRecords)[number]> = [
    { title: '登录时间', dataIndex: 'time' },
    { title: '登录IP', dataIndex: 'ip' },
    { title: '登录地点', dataIndex: 'location' },
    { title: '登录设备', dataIndex: 'device' },
    { title: '登录方式', dataIndex: 'type' },
  ];

  return (
    <ModulePage activeKey="profile" navItems={accountNav} title="个人中心">
      <div className="account-grid">
        <section className="rag-panel account-profile">
          <h3>个人信息</h3>
          <div className="profile-body">
            <div>
              <Avatar size={138} src={profile.avatar || user?.avatar} />
              <Button>更换头像</Button>
            </div>
            <dl>
              <dt>用户名</dt><dd>{profile.username}</dd>
              <dt>真实姓名</dt><dd>{profile.name}</dd>
              <dt>所属部门</dt><dd>{profile.department}</dd>
              <dt>职位</dt><dd>{profile.position}</dd>
              <dt>手机</dt><dd>{profile.phone}</dd>
              <dt>邮箱</dt><dd>{profile.email}</dd>
              <dt>用户状态</dt><dd><Tag color="success">正常</Tag></dd>
              <dt>创建时间</dt><dd>{profile.createdAt}</dd>
              <dt>更新时间</dt><dd>{profile.updatedAt}</dd>
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
          <Table columns={columns} dataSource={loginRecords} pagination={{ pageSize: 10, total: 25 }} rowKey="id" />
        </section>
        <section className="rag-panel permission-panel">
          <h3>个人权限</h3>
          <Table
            columns={[
              { title: '权限模块', dataIndex: 'module', width: 120 },
              { title: '权限说明', dataIndex: 'desc' },
            ]}
            dataSource={permissions}
            pagination={false}
            rowKey="module"
          />
        </section>
      </div>
    </ModulePage>
  );
};

export default AccountCenter;
