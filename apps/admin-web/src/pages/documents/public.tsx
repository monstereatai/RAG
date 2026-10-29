import { Documents } from './index';

/** 公共文档：权限主体含 public 的文档 */
export default function PublicDocuments() {
  return (
    <Documents
      activeKey="public"
      emptyDescription="在「我的文档」通过权限配置将文档设为公开后，会出现在这里。"
      emptyTitle="暂无公共文档"
      scope="public"
    />
  );
}
