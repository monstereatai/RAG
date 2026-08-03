import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history, Link } from '@umijs/max';
import React from 'react';

import { ErrorBoundary } from '@/components';
import { AdminShell } from '@/components/AdminShell';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

const isDev = process.env.NODE_ENV === 'development';
const loginPath = '/user/login';
const isPublicPath = (pathname: string) =>
  pathname === loginPath || pathname.startsWith('/shared/artifacts/');

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: API.CurrentUser;
  loading?: boolean;
  fetchUserInfo?: () => Promise<API.CurrentUser | undefined>;
  settingDrawerOpen?: boolean;
}> {
  const fetchUserInfo = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return undefined;
      const res = await fetch('/api/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        // 后端统一响应格式: { code, data: { data: user } }
        const outerData = json.data ?? json;
        return outerData.data ?? outerData;
      }
      return undefined;
    } catch {
      return undefined;
    }
  };

  const { location } = history;
  if (!isPublicPath(location.pathname)) {
    const currentUser = await fetchUserInfo();
    if (!currentUser) {
      history.replace(
        `${loginPath}?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`,
      );
    }
    return {
      fetchUserInfo,
      currentUser,
      settings: defaultSettings as Partial<LayoutSettings>,
      settingDrawerOpen: false,
    };
  }
  return {
    fetchUserInfo,
    settings: defaultSettings as Partial<LayoutSettings>,
    settingDrawerOpen: false,
  };
}

export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  return {
    headerRender: false,
    menuRender: false,
    menuHeaderRender: false,
    menuItemRender: (item, dom) => {
      if (item.path) {
        return (
          <Link to={item.path} prefetch>
            {dom}
          </Link>
        );
      }
      return dom;
    },
    actionsRender: () => [],
    avatarProps: {
      src: initialState?.currentUser?.avatar,
      title: initialState?.currentUser?.username ?? '用户',
      render: (_, avatarChildren) => (
        <span
          onClick={async () => {
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            const { fetchUserInfo } = initialState ?? {};
            if (fetchUserInfo) {
              const user = await fetchUserInfo();
              setInitialState((s) => ({ ...s, currentUser: user }));
            }
            history.push(loginPath);
          }}
        >
          {avatarChildren}
        </span>
      ),
    },
    footerRender: false,
    onPageChange: () => {
      const { location } = history;
      if (!initialState?.currentUser && !isPublicPath(location.pathname)) {
        history.replace(
          `${loginPath}?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`,
        );
      }
    },
    ErrorBoundary,
    childrenRender: (children) => {
      return (
        <AdminShell currentUser={initialState?.currentUser}>
          {children}
          {isDev && <SettingDrawer
            disableUrlParams
            enableDarkTheme
            collapse={initialState?.settingDrawerOpen}
            onCollapseChange={(open) => {
              setInitialState((s) => ({
                ...s,
                settingDrawerOpen: open,
              }));
            }}
            settings={initialState?.settings}
            onSettingChange={(settings) => {
              setInitialState((s) => ({
                ...s,
                settings,
              }));
            }}
          />}
        </AdminShell>
      );
    },
    ...initialState?.settings,
  };
};

export const request: RequestConfig = {
  baseURL: isDev ? '' : '',
  ...errorConfig,
};

export function rootContainer(container: React.ReactNode) {
  return <ErrorBoundary>{container}</ErrorBoundary>;
}
