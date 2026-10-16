# Team Wiki

## 用途与边界

Team Wiki 用于维护可编辑、带来源引用的团队主题页。它补充现有 RAG 文档和 GraphRAG：Wiki 页面本身不是源文档，发布后才通过已有文档入库流程成为可检索资料。

## 数据与权限

- 页面和每个不可变修订分别保存在 `team_wiki_pages`、`team_wiki_revisions`。
- 页面、修订和来源引用都受 `tenantId` 约束；引用必须指向同一 tenant 的现有文档，并且当前用户在保存引用时必须具有该文档的读取权限。API 从已认证用户解析 tenant，不接受请求体传入 tenant 覆盖。
- 发布时会再次检查全部来源文档的读取权限，防止页面编辑后来源 ACL 被撤销仍可发布；若用户已无权读取某个来源，发布会失败，直到移除或替换该引用。
- 修改时可提交 `expectedRevisionNumber` 防止覆盖别人较新的版本。版本差异按行比较；回滚会创建新的修订，保留完整历史。
- 删除页面采用软删除，并将其已发布文档归档。

## 发布流程

在 Team Wiki 管理页面编辑并保存后，可以显式发布当前修订。发布会将内容和来源链接交给现有文档入库服务，并记录发布状态、生成的文档 ID 与生命周期；后续新修订重新发布时，旧发布文档按现有生命周期规则退役。发布状态失败时可查看错误信息并再次发起。

启用文档审批时，新发布文档先处于 `draft`；审批通过后仍需通过现有“提升版本”操作激活。提升会沿 `supersedesDocId` 版本链在同一数据库事务中把旧版本设为 `deprecated`、新版本设为 `effective`。Wiki 页面、修订历史及重复发布响应会从当前文档元数据读取生命周期，避免继续显示初次发布时缓存的 `draft`。

来源引用存为文档 ID、标签和可选摘录，页面渲染到检索文档时形成指向原文档的 `rag://documents/{docId}` 引用。Wiki 发布不替代原始来源，也不跳过现有文档权限与检索过滤。由于访问权限可能在编辑和发布之间变化，发布时的 ACL 复核是必要门禁。

## 接口

RAG 用户 API 前缀为 `/api/v1/team-wiki`，使用 JWT。Admin 页面通过 Admin Backend 的 `/api/admin/team-wiki` 代理；代理端执行后台权限校验，再通过内部服务令牌调用 RAG 管理 API，tenant 根据目标用户解析。

主要操作包括列表／创建／读取／更新／软删除、修订列表、版本比较、回滚和发布。具体路由见 `backend/src/modules/team-wiki/team-wiki.controller.ts` 与 `admin-backend/src/modules/team-wiki/team-wiki.controller.ts`。

## 部署状态

Team Wiki 迁移 `backend/src/migrations/1788600000000-AddTeamWikiPages.ts` 已在当前本地 PostgreSQL 执行并由 `migration:show` 确认。其他环境上线前仍需按项目流程审查并应用该迁移；当前本地迁移和针对性测试不代表目标环境或生产验收完成。
