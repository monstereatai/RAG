import {
  ApartmentOutlined,
  AuditOutlined,
  BranchesOutlined,
  BellOutlined,
  ClockCircleOutlined,
  CommentOutlined,
  ControlOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FolderOutlined,
  GlobalOutlined,
  HistoryOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  NodeIndexOutlined,
  PieChartOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { history, Link } from '@umijs/max';
import { Avatar, Badge, Button, Dropdown, Space } from 'antd';
import type React from 'react';
import './style.less';

export interface SideNavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  path?: string;
}

const mainNav = [
  { label: '首页大盘', path: '/dashboard' },
  { label: '文档管理', path: '/documents' },
  { label: '智能搜索', path: '/search-ops' },
  { label: 'AI智能问答', path: '/qa-ops' },
  { label: 'Agent运营', path: '/agent-ops' },
  { label: '知识图谱', path: '/graph-ops' },
  { label: '个人中心', path: '/account/center' },
  { label: '系统管理', path: '/system/users' },
];

const moduleMatchers: Record<string, string[]> = {
  '/dashboard': ['/dashboard'],
  '/documents': ['/documents'],
  '/search-ops': ['/search-ops'],
  '/qa-ops': ['/qa-ops'],
  '/agent-ops': ['/agent-ops'],
  '/graph-ops': ['/graph-ops'],
  '/account/center': ['/account', '/account-security'],
  '/system/users': ['/system'],
};

export const dashboardNav: SideNavItem[] = [
  { key: 'overview', label: '数据总览', icon: <PieChartOutlined />, path: '/dashboard' },
  { key: 'visits', label: '访问分析', icon: <ClockCircleOutlined /> },
  { key: 'documents', label: '文档统计', icon: <FileTextOutlined /> },
  { key: 'users', label: '用户统计', icon: <TeamOutlined /> },
  { key: 'hot', label: '热门内容', icon: <GlobalOutlined /> },
  { key: 'notice', label: '系统公告', icon: <BellOutlined /> },
];

export const documentNav: SideNavItem[] = [
  { key: 'mine', label: '我的文档', icon: <FolderOutlined />, path: '/documents' },
  { key: 'public', label: '公共文档', icon: <GlobalOutlined /> },
  { key: 'department', label: '部门文档', icon: <ApartmentOutlined /> },
  { key: 'archive', label: '文档归档', icon: <DatabaseOutlined /> },
];

export const searchNav: SideNavItem[] = [
  { key: 'history', label: '搜索历史', icon: <ClockCircleOutlined />, path: '/search-ops' },
  { key: 'hot', label: '热门搜索', icon: <GlobalOutlined /> },
  { key: 'filter', label: '搜索筛选', icon: <SearchOutlined /> },
];

export const qaNav: SideNavItem[] = [
  { key: 'new', label: '新建对话', icon: <CommentOutlined />, path: '/qa-ops' },
  { key: 'history', label: '历史会话', icon: <HistoryOutlined /> },
  { key: 'records', label: '问答记录', icon: <FileTextOutlined /> },
  { key: 'model', label: '模型配置', icon: <DatabaseOutlined />, path: '/qa-ops/model' },
];

export const agentOpsNav: SideNavItem[] = [
  {
    key: 'workspace',
    label: 'Agent 工作台',
    icon: <BranchesOutlined />,
    path: '/agent-ops',
  },
  {
    key: 'bad-cases',
    label: 'Bad Case 审核',
    icon: <AuditOutlined />,
    path: '/agent-ops/bad-cases',
  },
  {
    key: 'evals',
    label: 'Agent Evals',
    icon: <ExperimentOutlined />,
    path: '/agent-ops/evals',
  },
  {
    key: 'traces',
    label: '调用轨迹',
    icon: <HistoryOutlined />,
    path: '/agent-ops/traces',
  },
  {
    key: 'artifacts',
    label: 'Artifact 审计',
    icon: <FileTextOutlined />,
    path: '/agent-ops/artifacts',
  },
];

export const graphNav: SideNavItem[] = [
  { key: 'global', label: '全局图谱', icon: <NodeIndexOutlined />, path: '/graph-ops' },
  { key: 'nodes', label: '节点管理', icon: <ApartmentOutlined />, path: '/graph-ops/nodes' },
  { key: 'relations', label: '关系检索', icon: <SearchOutlined />, path: '/graph-ops/relations' },
  { key: 'stats', label: '图谱统计', icon: <PieChartOutlined />, path: '/graph-ops/stats' },
];

export const accountNav: SideNavItem[] = [
  { key: 'profile', label: '个人信息', icon: <UserOutlined />, path: '/account/center' },
  { key: 'password', label: '密码修改', icon: <LockOutlined />, path: '/account-security' },
  { key: 'memories', label: '长期记忆', icon: <DatabaseOutlined />, path: '/account/memories' },
  { key: 'records', label: '登录记录', icon: <ClockCircleOutlined /> },
  { key: 'permissions', label: '权限查询', icon: <AuditOutlined /> },
];

export const systemNav: SideNavItem[] = [
  { key: 'users', label: '用户管理', icon: <UserOutlined />, path: '/system/users' },
  { key: 'roles', label: '角色权限', icon: <AuditOutlined />, path: '/system/roles' },
  { key: 'permissions', label: '权限管理', icon: <LockOutlined />, path: '/system/permissions' },
  { key: 'config', label: '系统配置', icon: <SettingOutlined />, path: '/system/config' },
  { key: 'logs', label: '日志管理', icon: <FileTextOutlined />, path: '/system/logs' },
  { key: 'menus', label: '菜单管理', icon: <MenuOutlined />, path: '/system/menus' },
  { key: 'notifications', label: '通知中心', icon: <BellOutlined />, path: '/system/notifications' },
  { key: 'service', label: '服务配置', icon: <ControlOutlined />, path: '/system/system-config' },
];

export function AdminShell({
  children,
  currentUser,
}: {
  children: React.ReactNode;
  currentUser?: API.CurrentUser;
}) {
  const pathname = history.location.pathname;
  const activePath =
    mainNav.find((item) =>
      moduleMatchers[item.path]?.some((prefix) => pathname.startsWith(prefix)),
    )?.path ?? '/dashboard';

  return (
    <div className="rag-admin-shell">
      <header className="rag-admin-topbar">
        <Link className="rag-admin-brand" to="/dashboard">
          <span className="rag-admin-logo" />
          <span>企业智能知识库系统</span>
        </Link>
        <nav className="rag-admin-main-nav">
          {mainNav.map((item) => (
            <Link
              className={item.path === activePath ? 'active' : ''}
              key={item.path}
              to={item.path}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="rag-admin-userbar">
          <Badge count={12} size="small">
            <BellOutlined className="rag-admin-bell" />
          </Badge>
          <Dropdown
            menu={{
              items: [{ key: 'logout', label: '退出登录' }],
              onClick: () => {
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                history.push('/user/login');
              },
            }}
          >
            <Space className="rag-admin-avatar">
              <Avatar src={currentUser?.avatar} icon={<UserOutlined />} />
              <span>{currentUser?.name ?? currentUser?.username ?? '管理员'}</span>
            </Space>
          </Dropdown>
        </div>
      </header>
      <main className="rag-admin-main">{children}</main>
    </div>
  );
}

export function ModulePage({
  title,
  navItems,
  activeKey,
  children,
}: {
  title: string;
  navItems: SideNavItem[];
  activeKey: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rag-module-page">
      <aside className="rag-module-side">
        <h2>{title}</h2>
        <div className="rag-module-side-list">
          {navItems.map((item) => {
            const content = (
              <>
                {item.icon}
                <span>{item.label}</span>
              </>
            );
            const className = item.key === activeKey ? 'active' : '';
            return item.path ? (
              <Link className={className} key={item.key} to={item.path}>
                {content}
              </Link>
            ) : (
              <button className={className} key={item.key} type="button">
                {content}
              </button>
            );
          })}
        </div>
        <Button className="rag-collapse-btn" icon={<MenuFoldOutlined />} type="text">
          收起菜单
        </Button>
      </aside>
      <section className="rag-module-content">{children}</section>
    </div>
  );
}
