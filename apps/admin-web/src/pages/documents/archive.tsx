import { Documents } from './index';

/** 文档归档：lifecycleStatus=archived 的文档，可恢复为生效 */
export default function ArchiveDocuments() {
  return (
    <Documents
      activeKey="archive"
      emptyDescription="在「我的文档」归档的文档会出现在这里，归档后不再参与检索与问答。"
      emptyTitle="暂无归档文档"
      lifecycleStatus="archived"
    />
  );
}
