export default [
  {
    path: '/shared/artifacts/:token',
    layout: false,
    component: './shared-artifact',
  },
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
    routes: [
      {
        path: '/qa-ops',
        component: './qa-ops',
      },
      {
        path: '/qa-ops/model',
        name: 'qa-ops-model',
        component: './qa-ops/model',
      },
    ],
  },
  {
    path: '/agent-ops',
    name: 'agent-ops',
    icon: 'branches',
    routes: [
      {
        path: '/agent-ops',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/run-center',
        name: 'agent-ops-run-center',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/schedules',
        name: 'agent-ops-schedules',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/run-center/:id',
        name: 'agent-ops-run-detail',
        component: './agent-ops/run-detail',
      },
      {
        path: '/agent-ops/collaboration',
        name: 'agent-ops-collaboration',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/bad-cases',
        name: 'agent-ops-bad-cases',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/evals',
        name: 'agent-ops-evals',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/traces',
        name: 'agent-ops-traces',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/artifacts',
        name: 'agent-ops-artifacts',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/governance',
        name: 'agent-ops-governance',
        component: './agent-ops',
      },
      {
        path: '/agent-ops/workflows/:threadId',
        name: 'agent-ops-workflow-detail',
        component: './agent-ops/workflow-detail',
      },
    ],
  },
  {
    path: '/graph-ops',
    name: 'graph-ops',
    icon: 'apartment',
    routes: [
      {
        path: '/graph-ops',
        component: './graph-ops',
      },
      {
        path: '/graph-ops/nodes',
        name: 'graph-ops-nodes',
        component: './graph-ops',
      },
      {
        path: '/graph-ops/relations',
        name: 'graph-ops-relations',
        component: './graph-ops',
      },
      {
        path: '/graph-ops/stats',
        name: 'graph-ops-stats',
        component: './graph-ops',
      },
    ],
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
      {
        path: '/system/notifications',
        name: 'notifications',
        component: './system/notifications',
      },
      {
        path: '/system/system-config',
        name: 'system-config',
        component: './system/system-config',
      },
      {
        path: '/system/audit-logs',
        name: 'audit-logs',
        component: './system/audit-logs',
      },
      {
        path: '/system/menus',
        name: 'menus',
        component: './system/menus',
      },
    ],
  },
  {
    path: '/account-security',
    name: 'account-security',
    icon: 'safety',
    component: './account-security',
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
      {
        name: 'memories',
        icon: 'database',
        path: '/account/memories',
        component: './account/memories',
      },
    ],
  },
  {
    component: './exception/404',
    path: '/*',
  },
];
