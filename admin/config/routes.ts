export default [
  {
    path: '/user',
    layout: false,
    routes: [
      {
        path: '/user/login',
        name: 'login',
        component: './user/login',
      },
      {
        path: '/user',
        redirect: '/user/login',
      },
      {
        name: '404',
        component: './exception/404',
        path: '/user/*',
      },
    ],
  },
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    icon: 'dashboard',
    component: './dashboard',
  },
  {
    path: '/documents',
    name: 'documents',
    icon: 'fileText',
    routes: [
      {
        path: '/documents',
        component: './documents',
      },
      {
        path: '/documents/:id',
        name: 'document-detail',
        component: './documents/detail',
        hideInMenu: true,
      },
    ],
  },
  {
    path: '/search-ops',
    name: 'search-ops',
    icon: 'search',
    component: './search-ops',
  },
  {
    path: '/qa-ops',
    name: 'qa-ops',
    icon: 'comment',
    component: './qa-ops',
  },
  {
    path: '/graph-ops',
    name: 'graph-ops',
    icon: 'apartment',
    component: './graph-ops',
  },
  {
    path: '/system',
    name: 'system',
    icon: 'setting',
    access: 'canAdmin',
    routes: [
      {
        path: '/system',
        redirect: '/system/users',
      },
      {
        path: '/system/users',
        name: 'users',
        component: './system/users',
      },
      {
        path: '/system/roles',
        name: 'roles',
        component: './system/roles',
      },
      {
        path: '/system/permissions',
        name: 'permissions',
        component: './system/permissions',
      },
      {
        path: '/system/config',
        name: 'config',
        component: './system/config',
      },
      {
        path: '/system/logs',
        name: 'logs',
        component: './system/logs',
      },
    ],
  },
  {
    path: '/notifications',
    name: 'notifications',
    icon: 'bell',
    component: './notifications',
  },
  {
    path: '/system-config',
    name: 'system-config',
    icon: 'control',
    component: './system-config',
  },
  {
    path: '/audit-logs',
    name: 'audit-logs',
    icon: 'audit',
    component: './audit-logs',
  },
  {
    path: '/account-security',
    name: 'account-security',
    icon: 'safety',
    component: './account-security',
  },
  {
    path: '/menus',
    name: 'menus',
    icon: 'menu',
    component: './menus',
  },
  {
    path: '/account',
    name: 'account',
    icon: 'user',
    routes: [
      {
        path: '/account',
        redirect: '/account/center',
      },
      {
        name: 'center',
        icon: 'user',
        path: '/account/center',
        component: './account/center',
      },
      {
        name: 'settings',
        icon: 'setting',
        path: '/account/settings',
        component: './account/settings',
      },
    ],
  },
  {
    component: './exception/404',
    path: '/*',
  },
];
