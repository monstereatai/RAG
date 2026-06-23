import { Injectable } from '@nestjs/common';

export interface AdminMenuItem {
  key: string;
  title: string;
  path: string;
  permission: string;
  children?: AdminMenuItem[];
}

@Injectable()
export class AdminMenusService {
  private readonly menus: AdminMenuItem[] = [
    {
      key: 'dashboard',
      title: '首页大盘',
      path: '/admin/dashboard',
      permission: 'admin:dashboard:read',
      children: [
        { key: 'dashboard.overview', title: '数据总览', path: '/admin/dashboard/overview', permission: 'admin:dashboard:read' },
        { key: 'dashboard.analytics', title: '访问分析', path: '/admin/dashboard/analytics', permission: 'admin:dashboard:read' },
      ],
    },
    {
      key: 'documents',
      title: '文档管理',
      path: '/admin/documents',
      permission: 'admin:documents:read',
      children: [
        { key: 'documents.list', title: '文档列表', path: '/admin/documents', permission: 'admin:documents:read' },
        { key: 'documents.reindex', title: '重建索引', path: '/admin/documents/reindex', permission: 'admin:rag:write' },
      ],
    },
    {
      key: 'searchOps',
      title: '智能搜索运营',
      path: '/admin/search-ops',
      permission: 'admin:search-ops:read',
    },
    {
      key: 'qaOps',
      title: 'AI 问答运营',
      path: '/admin/qa-ops',
      permission: 'admin:qa-ops:read',
    },
    {
      key: 'graphOps',
      title: '知识图谱运营',
      path: '/admin/graph-ops',
      permission: 'admin:graph-ops:read',
    },
    {
      key: 'system',
      title: '系统管理',
      path: '/admin/system',
      permission: 'admin:system:read',
      children: [
        { key: 'system.users', title: '用户管理', path: '/admin/users', permission: 'admin:users:read' },
        { key: 'system.roles', title: '角色管理', path: '/admin/roles', permission: 'admin:roles:read' },
        { key: 'system.permissions', title: '权限管理', path: '/admin/permissions', permission: 'admin:permissions:read' },
        { key: 'system.auditLogs', title: '审计日志', path: '/admin/audit-logs', permission: 'admin:audit:read' },
        { key: 'system.notifications', title: '通知中心', path: '/admin/notifications', permission: 'admin:notifications:read' },
        { key: 'system.config', title: '系统配置', path: '/admin/system-config', permission: 'admin:system:read' },
      ],
    },
  ];

  getTree() {
    return {
      storage: 'static',
      persisted: false,
      blocker: '菜单持久化和拖拽排序需要数据库 schema，当前先提供静态菜单树。',
      items: this.menus,
    };
  }

  getSidebar(permissions: string[] = []) {
    return {
      items: this.filterByPermissions(this.menus, permissions),
      permissionCount: permissions.length,
    };
  }

  getButtonPermissions() {
    return {
      storage: 'static',
      items: [
        'admin:documents:read',
        'admin:documents:write',
        'admin:rag:read',
        'admin:rag:write',
        'admin:audit:read',
        'admin:notifications:read',
        'admin:notifications:write',
        'admin:system:read',
        'admin:account-security:read',
      ],
    };
  }

  private filterByPermissions(items: AdminMenuItem[], permissions: string[]): AdminMenuItem[] {
    if (permissions.length === 0) {
      return [];
    }

    const visibleItems: AdminMenuItem[] = [];

    for (const item of items) {
      const children = item.children
        ? this.filterByPermissions(item.children, permissions)
        : undefined;

      if (permissions.includes(item.permission) || (children && children.length > 0)) {
        visibleItems.push({
          ...item,
          children,
        });
      }
    }

    return visibleItems;
  }
}
