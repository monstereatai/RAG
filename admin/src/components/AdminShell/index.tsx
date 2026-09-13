import {
  ApartmentOutlined,
  AuditOutlined,
  BranchesOutlined,
  BellOutlined,
  CheckOutlined,
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
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { history, Link } from '@umijs/max';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Empty,
  Popover,
  Space,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  getNotifications,
  markAllAsRead,
  markAsRead,
  type Notification,
} from '@/pages/system/notifications/service';
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

const notificationTypeMap: Record<
  Notification['type'],
  { color: string; label: string }
> = {
  system: { color: 'blue', label: '系统' },
  alert: { color: 'red', label: '告警' },
  info: { color: 'green', label: '信息' },
};

const normalizeNotificationResult = (result: unknown) => {
  const payload = (result as any)?.data ?? result;
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.items)
      ? (payload as any).items
      : [];

  return {
    items: items as Notification[],
    total: Number((payload as any)?.total ?? items.length),
    unread: Number(
      (payload as any)?.unread ??
        items.filter((item: Notification) => !item.read).length,
    ),
  };
};

const formatNotificationTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const unreadIds = useMemo(
    () => notifications.filter((item) => !item.read).map((item) => item.id),
    [notifications],
  );

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getNotifications({ current: 1, pageSize: 6 });
      const normalized = normalizeNotificationResult(result);
      setNotifications(normalized.items);
      setUnread(normalized.unread);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '消息加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      loadNotifications();
    }
  };

  const handleRead = async (id: string) => {
    await markAsRead(id);
    setNotifications((items) =>
      items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
    setUnread((count) => Math.max(0, count - 1));
  };

  const handleReadAll = async () => {
    if (unreadIds.length === 0) return;
    await markAllAsRead();
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
    setUnread(0);
    message.success('消息已全部标记为已读');
  };

  const content = (
    <div className="rag-notification-panel">
      <div className="rag-notification-panel-head">
        <div>
          <strong>消息中心</strong>
          <span>{unread > 0 ? `${unread} 条未读` : '暂无未读消息'}</span>
        </div>
        <Space size={4}>
          <Tooltip title="刷新">
            <Button
              aria-label="刷新消息"
              icon={<ReloadOutlined />}
              loading={loading}
              size="small"
              type="text"
              onClick={loadNotifications}
            />
          </Tooltip>
          <Tooltip title="全部已读">
            <Button
              aria-label="全部已读"
              disabled={unreadIds.length === 0}
              icon={<CheckOutlined />}
              size="small"
              type="text"
              onClick={handleReadAll}
            />
          </Tooltip>
        </Space>
      </div>
      <ul className="rag-notification-list" aria-busy={loading}>
        {notifications.length === 0 ? (
          <Empty
            description={loading ? '消息加载中' : '暂无消息'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          notifications.map((item) => {
            const typeMeta = notificationTypeMap[item.type] ?? {
              color: 'default',
              label: item.type,
            };
            return (
              <li
                className={item.read ? 'rag-notification-row' : 'rag-notification-row unread'}
                key={item.id}
              >
                <div className="rag-notification-item">
                  <div className="rag-notification-item-title">
                    <span>{item.title}</span>
                    <Tag color={typeMeta.color} variant="filled">
                      {typeMeta.label}
                    </Tag>
                  </div>
                  <p>{item.content}</p>
                  <div className="rag-notification-item-foot">
                    <span>{formatNotificationTime(item.createdAt)}</span>
                    {!item.read && (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => handleRead(item.id)}
                      >
                        标记已读
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
      <Button
        block
        className="rag-notification-more"
        icon={<RightOutlined />}
        iconPlacement="end"
        type="text"
        onClick={() => {
          setOpen(false);
          history.push('/system/notifications');
        }}
      >
        查看全部消息
      </Button>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      open={open}
      placement="bottomRight"
      trigger="click"
      onOpenChange={handleOpenChange}
    >
      <Button
        aria-label="打开消息中心"
        className="rag-admin-bell-btn"
        type="text"
      >
        <Badge count={unread} size="small">
          <BellOutlined className="rag-admin-bell" />
        </Badge>
      </Button>
    </Popover>
  );
}

export const dashboardNav: SideNavItem[] = [
  {
    key: 'overview',
    label: '数据总览',
    icon: <PieChartOutlined />,
    path: '/dashboard',
  },
  { key: 'visits', label: '访问分析', icon: <ClockCircleOutlined /> },
  { key: 'documents', label: '文档统计', icon: <FileTextOutlined /> },
  { key: 'users', label: '用户统计', icon: <TeamOutlined /> },
  { key: 'hot', label: '热门内容', icon: <GlobalOutlined /> },
  { key: 'notice', label: '系统公告', icon: <BellOutlined /> },
];

export const documentNav: SideNavItem[] = [
  {
    key: 'mine',
    label: '我的文档',
    icon: <FolderOutlined />,
    path: '/documents',
  },
  {
    key: 'public',
    label: '公共文档',
    icon: <GlobalOutlined />,
    path: '/documents/public',
  },
  {
    key: 'department',
    label: '部门文档',
    icon: <ApartmentOutlined />,
    path: '/documents/department',
  },
  {
    key: 'archive',
    label: '文档归档',
    icon: <DatabaseOutlined />,
    path: '/documents/archive',
  },
];

export const searchNav: SideNavItem[] = [
  {
    key: 'history',
    label: '搜索历史',
    icon: <ClockCircleOutlined />,
    path: '/search-ops',
  },
  { key: 'hot', label: '热门搜索', icon: <GlobalOutlined /> },
  { key: 'filter', label: '搜索筛选', icon: <SearchOutlined /> },
  { key: 'evidence', label: '检索证据实验台', icon: <ExperimentOutlined />, path: '/search-ops/evidence' },
];

export const qaNav: SideNavItem[] = [
  { key: 'new', label: '新建对话', icon: <CommentOutlined />, path: '/qa-ops' },
  { key: 'history', label: '历史会话', icon: <HistoryOutlined /> },
  { key: 'records', label: '问答记录', icon: <FileTextOutlined /> },
  {
    key: 'model',
    label: '模型配置',
    icon: <DatabaseOutlined />,
    path: '/qa-ops/model',
  },
];

export const agentOpsNav: SideNavItem[] = [
  {
    key: 'workspace',
    label: '产研运工作流',
    icon: <BranchesOutlined />,
    path: '/agent-ops',
  },
  {
    key: 'run-center',
    label: '运行中心',
    icon: <HistoryOutlined />,
    path: '/agent-ops/run-center',
  },
  {
    key: 'schedules',
    label: '定时任务',
    icon: <ClockCircleOutlined />,
    path: '/agent-ops/schedules',
  },
  {
    key: 'collaboration',
    label: '协作编排',
    icon: <ApartmentOutlined />,
    path: '/agent-ops/collaboration',
  },
  {
    key: 'evals',
    label: 'Agent Evals',
    icon: <ExperimentOutlined />,
    path: '/agent-ops/evals',
  },
  {
    key: 'governance',
    label: '平台治理',
    icon: <DatabaseOutlined />,
    path: '/agent-ops/governance',
  },
  {
    key: 'bad-cases',
    label: 'Bad Case 审核',
    icon: <AuditOutlined />,
    path: '/agent-ops/bad-cases',
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
  {
    key: 'global',
    label: '全局图谱',
    icon: <NodeIndexOutlined />,
    path: '/graph-ops',
  },
  {
    key: 'nodes',
    label: '节点管理',
    icon: <ApartmentOutlined />,
    path: '/graph-ops/nodes',
  },
  {
    key: 'relations',
    label: '关系检索',
    icon: <SearchOutlined />,
    path: '/graph-ops/relations',
  },
  {
    key: 'stats',
    label: '图谱统计',
    icon: <PieChartOutlined />,
    path: '/graph-ops/stats',
  },
];

export const accountNav: SideNavItem[] = [
  {
    key: 'profile',
    label: '个人信息',
    icon: <UserOutlined />,
    path: '/account/center',
  },
  {
    key: 'password',
    label: '密码修改',
    icon: <LockOutlined />,
    path: '/account-security',
  },
  {
    key: 'memories',
    label: '长期记忆',
    icon: <DatabaseOutlined />,
    path: '/account/memories',
  },
  { key: 'records', label: '登录记录', icon: <ClockCircleOutlined /> },
  { key: 'permissions', label: '权限查询', icon: <AuditOutlined /> },
];

export const systemNav: SideNavItem[] = [
  {
    key: 'users',
    label: '用户管理',
    icon: <UserOutlined />,
    path: '/system/users',
  },
  {
    key: 'teams',
    label: '组织架构',
    icon: <TeamOutlined />,
    path: '/system/teams',
  },
  {
    key: 'roles',
    label: '角色权限',
    icon: <AuditOutlined />,
    path: '/system/roles',
  },
  {
    key: 'permissions',
    label: '权限管理',
    icon: <LockOutlined />,
    path: '/system/permissions',
  },
  {
    key: 'config',
    label: '系统配置',
    icon: <SettingOutlined />,
    path: '/system/config',
  },
  {
    key: 'logs',
    label: '日志管理',
    icon: <FileTextOutlined />,
    path: '/system/logs',
  },
  {
    key: 'menus',
    label: '菜单管理',
    icon: <MenuOutlined />,
    path: '/system/menus',
  },
  {
    key: 'notifications',
    label: '通知中心',
    icon: <BellOutlined />,
    path: '/system/notifications',
  },
  {
    key: 'service',
    label: '服务配置',
    icon: <ControlOutlined />,
    path: '/system/system-config',
  },
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
          <NotificationBell />
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
              <span>
                {currentUser?.name ?? currentUser?.username ?? '管理员'}
              </span>
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
  onNavChange,
}: {
  title: React.ReactNode;
  navItems: SideNavItem[];
  activeKey: string;
  children: React.ReactNode;
  /** 可选：点击侧边栏项时的回调（无 path 的项靠它切换视图；有 path 的项在导航外额外触发） */
  onNavChange?: (key: string) => void;
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
            const handleNav = onNavChange
              ? () => onNavChange(item.key)
              : undefined;
            return item.path ? (
              <Link
                className={className}
                key={item.key}
                to={item.path}
                onClick={handleNav}
              >
                {content}
              </Link>
            ) : (
              <button
                className={className}
                key={item.key}
                type="button"
                onClick={handleNav}
              >
                {content}
              </button>
            );
          })}
        </div>
        <Button
          className="rag-collapse-btn"
          icon={<MenuFoldOutlined />}
          type="text"
        >
          收起菜单
        </Button>
      </aside>
      <section className="rag-module-content">{children}</section>
    </div>
  );
}
