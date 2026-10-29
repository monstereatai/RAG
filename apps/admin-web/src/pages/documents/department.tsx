import { Documents } from './index';

/** 部门文档：权限主体含 department 的文档，支持按部门筛选 */
export default function DepartmentDocuments() {
  return (
    <Documents
      activeKey="department"
      emptyDescription="在「我的文档」通过权限配置将文档授权给部门后，会出现在这里。"
      emptyTitle="暂无部门文档"
      scope="department"
    />
  );
}
