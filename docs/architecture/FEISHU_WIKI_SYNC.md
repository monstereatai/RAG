# 飞书知识空间同步

## 范围

首版从指定飞书 Wiki 知识空间只读同步新版文档（`docx`），递归遍历节点和分页读取文档块，再交给现有文档入库与索引流程。表格、多维表格、旧版 `doc`、图片附件等未支持对象会跳过。

同步会计算正文 SHA-256：内容未变化时不重复入库；内容变化时创建一份新的本地文档版本，并将上一份标记为 `deprecated`。只有完整遍历成功后，才会对远端已移除的节点执行本地失效：先把共享给租户的 ACL 收紧为仅连接器 owner 可读，再将文档生命周期设为 `deprecated`，两个步骤成功后才把同步项标为 inactive。ACL 撤权或生命周期更新失败时，同步报错且不会把该项记为完成失效；已成功撤权但生命周期更新失败时，页面仍显示为 active，需检查同步错误，但租户共享访问已先被收回。本地原始文件不会被物理删除。每页响应必须含有 `items` 数组和布尔值 `has_more`，每个节点必须含非空 `node_token` 和布尔值 `has_child`；结构异常或部分 API 失败时同步状态记为失败，不执行缺失节点清理。

## 凭据与权限

RAG Backend 运行环境读取 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET`，通过飞书开放平台获取 `tenant_access_token`。凭据不经浏览器和 Admin Backend 传递，也不写入仓库。由于该令牌代表全局飞书应用身份，必须同时配置 `FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS`，显式列出允许使用此飞书应用的 RAG tenantId（多个值用逗号分隔）；未列入的租户不能查询或同步。这个 allowlist 只是 RAG 租户准入门禁，不会把不同 RAG 租户分别映射到飞书租户或 Space；获准租户共享该应用在飞书侧可读取的空间范围。首轮只应 allowlist 可信租户，并把飞书应用权限限制到目标知识空间；多租户 SaaS 若需空间级隔离，应先实现每租户独立授权或明确的 Space allowlist。

飞书应用令牌代表应用身份，其可见范围由飞书应用权限决定。飞书 API 本身没有在此同步链路中映射到本地逐用户 ACL，因此本地默认只允许发起同步的管理员访问导入文档。管理员可在同步时显式勾选“共享给本租户用户”；本地权限仍按 RAG 的 tenantId 过滤。启用共享前，应先在飞书侧把应用数据权限限制到目标知识空间。

同步状态通过数据库条件更新原子领取，避免两个请求同时处理同一空间；服务异常退出后，超过 24 小时的连接器状态允许重新领取。

## 操作

Admin 管理端“飞书 Wiki”页面填写知识空间 ID 并点击“同步”。同步为手动全量节点遍历、按内容哈希增量入库。状态页展示最近同步时间、同步错误、活动和失效节点数量。

RAG API：

- `POST /api/v1/integrations/feishu/wiki/sync`，JSON `{ "spaceId": "...", "shareWithinTenant": false }`
- `GET /api/v1/integrations/feishu/wiki/status?spaceId=...`
- Admin Backend 使用内部 `/api/v1/rag/admin/integrations/feishu/wiki/...` 代理；它从 RAG 用户记录解析租户，不接受浏览器提供的 tenantId。

新增数据库迁移：`backend/src/migrations/1788700000000-AddFeishuWikiSync.ts`。该迁移已在当前本地 PostgreSQL 执行并经 `migration:show` 确认；其他环境部署前按项目数据库变更流程审查并执行，本地开发过程不自动执行迁移。

## 官方接口

- [获取 Wiki 子节点列表](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/list)
- [获取 Wiki 节点信息](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node)
- [获取自建应用 tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)
- [飞书远程 MCP 工具说明](https://open.feishu.cn/document/mcp_open_tools/supported-tools?lang=zh-CN)
