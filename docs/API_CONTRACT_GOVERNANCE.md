# API 契约治理

## 版本

- Backend 对外路径使用 `/api/v1`；内部 Admin → RAG 路由保持服务 Token 隔离。
- Admin Backend 对外路径使用 `/api`，新增破坏性字段必须先新增版本或兼容字段。
- 响应统一保留 `code`、`message`、`data` 外层；代理层必须使用响应适配器解包，不允许页面自行猜测层级。

## 兼容规则

- 新字段只能追加，已有字段不得改变类型或语义。
- 删除字段前至少保留一个兼容周期，并在 Swagger `deprecated` 标记。
- 写接口支持幂等键时使用 `Idempotency-Key`；重复请求必须返回同一业务结果或明确冲突码。
- 列表接口必须支持分页上限，错误响应必须包含稳定错误码和可定位的 requestId。

## 自动检查

- Backend：`OPENAPI_REQUIRED=true pnpm --dir backend run contract:openapi`
- Admin Backend：`OPENAPI_REQUIRED=true pnpm --dir admin-backend run contract:openapi`
- 关键路径必须存在、带中文摘要、包含鉴权声明；生产发布前必须在服务已启动状态执行，不能接受 skipped。
