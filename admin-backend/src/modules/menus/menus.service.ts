import { Injectable } from '@nestjs/common';

@Injectable()
export class MenusService {
  private menuIdCounter = 100;

  /** 返回管理后台菜单树（静态，后续可持久化） */
  getMenuTree() {
    return {
      data: [
        {
          id: '1',
          name: '仪表盘',
          path: '/dashboard',
          icon: 'DashboardOutlined',
          sort: 1,
          visible: true,
          children: [],
        },
        {
          id: '2',
          name: '文档管理',
          path: '/documents',
          icon: 'FileTextOutlined',
          sort: 2,
          visible: true,
          children: [],
        },
        {
          id: '3',
          name: 'RAG 运维',
          path: '/rag-ops',
          icon: 'RobotOutlined',
          sort: 3,
          visible: true,
          children: [
            { id: '3-1', name: '检索分析', path: '/rag-ops/search', icon: 'SearchOutlined', sort: 1, visible: true, children: [] },
            { id: '3-2', name: 'QA 分析', path: '/rag-ops/qa', icon: 'CommentOutlined', sort: 2, visible: true, children: [] },
            { id: '3-3', name: '图谱管理', path: '/rag-ops/graph', icon: 'ApartmentOutlined', sort: 3, visible: true, children: [] },
          ],
        },
        {
          id: '4',
          name: '系统管理',
          path: '/system',
          icon: 'SettingOutlined',
          sort: 4,
          visible: true,
          children: [
            { id: '4-1', name: '用户管理', path: '/system/users', icon: 'UserOutlined', sort: 1, visible: true, children: [] },
            { id: '4-2', name: '角色管理', path: '/system/roles', icon: 'TeamOutlined', sort: 2, visible: true, children: [] },
            { id: '4-3', name: '权限管理', path: '/system/permissions', icon: 'SafetyOutlined', sort: 3, visible: true, children: [] },
            { id: '4-4', name: '菜单管理', path: '/system/menus', icon: 'MenuOutlined', sort: 4, visible: true, children: [] },
            { id: '4-5', name: '系统配置', path: '/system/config', icon: 'ToolOutlined', sort: 5, visible: true, children: [] },
          ],
        },
        {
          id: '5',
          name: '通知中心',
          path: '/notifications',
          icon: 'BellOutlined',
          sort: 5,
          visible: true,
          children: [],
        },
        {
          id: '6',
          name: '账号安全',
          path: '/account-security',
          icon: 'LockOutlined',
          sort: 6,
          visible: true,
          children: [],
        },
      ],
    };
  }

  createMenu(body: { name: string; path: string; icon?: string; parentId?: string; sort?: number; visible?: boolean }) {
    const id = String(this.menuIdCounter++);
    return { success: true, id, ...body, note: '内存模式，重启后失效' };
  }

  updateMenu(id: string, body: { name?: string; path?: string; icon?: string; sort?: number; visible?: boolean }) {
    return { success: true, id, ...body, note: '内存模式，重启后失效' };
  }

  deleteMenu(id: string) {
    return { success: true, id };
  }
}
