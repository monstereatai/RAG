export type PageState = 'loading' | 'data' | 'error' | 'empty';

export interface DocumentListPageProps {
  /** 按权限主体过滤：public=公共文档，department=部门文档；不传为全部（我的文档） */
  scope?: 'public' | 'department';
  /** 按生命周期状态过滤，如 'archived'（文档归档页） */
  lifecycleStatus?: string;
  /** 侧边菜单高亮 key */
  activeKey?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}
