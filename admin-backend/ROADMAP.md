# Admin Backend ROADMAP

> 管理后台后端真实进度源。只有已实现并验证的事项才能标为完成。未验证、依赖外部服务或涉及红线的事项必须明确记录阻塞原因。

## 当前结论

当前 `admin-backend` 已完成独立 NestJS 项目迁入、项目命名修正、基础模块装配和部分管理后台运营入口，但还不是完整管理后台。

当前优先级：

1. 先补齐不需要数据库 schema 变更的后台 API 闭环。
2. 再补齐依赖 `rag-backend` 的运营 API 契约。
3. 涉及数据库 schema、迁移、生产部署、真实密钥的事项先记录，不直接执行。

## 已完成

- [x] 独立项目目录命名为 `admin-backend/`。
- [x] `package.json`、`package-lock.json`、README、CLAUDE、health/tracing service name 已对齐为 `admin-backend`。
- [x] 基础认证模块存在：`POST /auth/login`、`GET /auth/refresh`。
- [x] 用户基础 CRUD 存在：`POST /users`、`GET /users`、`GET /users/:id`、`PUT /users/:id`、`DELETE /users/:id`。
- [x] 角色基础 CRUD 存在：`POST /roles`、`GET /roles`、`GET /roles/:id`、`PUT /roles/:id`、`DELETE /roles/:id`、`POST /roles/:id/permissions`。
- [x] 权限基础 CRUD 存在：`POST /permissions`、`GET /permissions`、`GET /permissions/:id`、`PUT /permissions/:id`、`DELETE /permissions/:id`。
- [x] RAG HTTP client 骨架存在，当前不 import RAG 内部 service，不访问向量库。
- [x] 后台文档治理入口存在：`GET /admin/documents`、`GET /admin/documents/:docId`、`GET /admin/documents/:docId/chunks`。
- [x] RAG 运营入口存在：capabilities、vector-index、evaluations、conversations、reindex、run-evaluation。
- [x] 审计日志查询骨架存在，数据库未启用时返回明确 disabled 状态。
- [x] 通知中心骨架存在，当前为进程内静态数据。
- [x] 系统配置状态接口存在，返回配置状态且不返回密钥。
- [x] 管理后台功能总览接口完成：`GET /admin/features` 返回模块完成度、缺口、阻塞原因。
- [x] 个人中心基础接口完成：`GET /admin/profile` 返回当前 token 中的用户资料、角色、权限和偏好占位。
- [x] 首页大盘数据结构补强：`GET /admin/dashboard` 返回 cards、trends、documentCategories、recentOperations、upstream.ragService 可用状态；缺真实数据时返回空数组和明确说明。
- [x] 通知中心基础闭环完成：列表、未读数、标记单条已读、全部已读。
- [x] 审计日志筛选参数完成：limit、action、actor、keyword；数据库未启用时返回 filters 和 disabled 状态。
- [x] 系统配置状态聚合补强：返回 auth/users/roles/permissions/dashboard/documents/ragOps/auditLogs/notifications/systemConfig 模块状态与阻塞原因。
- [x] RAG 运营 API 契约文档完成：`docs/rag-admin-api-contract.md`。
- [x] 完整验证通过：`npm run verify` 覆盖 build、lint、unit、e2e、migration check。
- [x] 账号安全基础版完成：登录失败次数与临时锁定使用进程内策略接入登录流程；忘记密码和 MFA 返回明确 blocked。
- [x] 菜单管理基础版完成：静态菜单树、当前用户侧边栏、按钮权限点接口完成；持久化和排序暂不做。
- [x] 审计日志写入基础版完成：已有全局 `AuditLogInterceptor`，关键写操作已补 `@AuditLog` 标记；数据库未启用时不阻塞请求。
- [x] 文档管理完整动作入口完成：上传、下载、归档、权限范围、批量操作返回明确 blocked；重建索引继续走 RAG client。
- [x] 智能搜索运营入口完成：`GET /admin/search-ops/overview` 返回 required RAG APIs 和 blocked 状态。
- [x] AI 问答运营入口完成：`GET /admin/qa-ops/overview` 返回 required RAG APIs 和 blocked 状态。
- [x] 知识图谱运营入口完成：`GET /admin/graph-ops/overview` 返回 required RAG APIs 和 blocked 状态。
- [x] 知识图谱运营三个二级菜单接口补齐：`GET /api/admin/graph-ops/nodes/:id`、`GET /api/admin/graph-ops/relations`、`GET /api/admin/graph-ops/relations/search`、`GET /api/admin/graph-ops/search` 已接入 rag-backend，并在真实图谱为空时返回显式 `meta.demo=true` 演示数据。
- [x] 组织权限联调基础接口完成：`GET /api/admin/organizations` 返回脱敏部门、岗位和树形数据，供文档权限主体选择使用；不涉及数据库 schema 变更。

## P0 当前必须补齐

- [x] 管理后台功能总览接口：返回模块完成度、缺口、阻塞原因，供前端首页或开发排期使用。
- [x] 首页大盘数据结构完善：补齐趋势、分类占比、近期操作、RAG upstream 健康状态，缺数据时返回明确 unavailable/empty。
- [x] 个人中心基础接口：当前管理员资料、权限、角色、偏好占位，不触碰数据库 schema。
- [x] 通知中心基础闭环：列表、未读数、标记已读、全部已读。
- [x] 审计日志筛选参数：limit、action、actor、keyword；数据库未启用时仍返回明确 disabled。
- [x] 文档治理操作占位：重建索引、查看 chunks、查看解析状态通过 RAG client；缺 RAG API 时明确返回 unavailable/blocked。
- [x] 系统管理状态聚合：数据库、Redis、队列、RAG 服务、审计、通知、权限模块状态。
- [x] `rag-backend` 运营 API 缺口清单：明确当前后台需要但 RAG 后端尚未暴露的接口。

## P1 后续增强

- [x] 账号安全：账号锁定、登录失败次数已接入进程内策略；忘记密码、MFA 因外部通道和持久化需求返回 blocked。
- [x] 菜单管理：静态菜单树、路由权限、按钮权限接口已完成；持久化、拖拽排序、菜单 CRUD 需要数据库 schema，先不执行。
- [x] 通知持久化：新增 `Notification` entity + 数据库持久化；数据库未启用时自动降级内存回退；Service 新增 `create()` 方法供内部模块调用。（2026-06-24）
- [x] 审计日志写入规范：已有全局审计拦截器，登录、用户、角色、权限、通知、文档治理关键写操作已补 `@AuditLog` 标记；数据库未启用时降级为 debug。
- [x] 后台大盘真实趋势：`overview()` 接入 rag-backend 真实数据（热门 query TOP-N、成本统计）；通知模块支持数据库持久化；大盘卡片（文档/问答/评测/向量索引）拉取真实 RAG 数据。（2026-06-24）
- [x] 文档管理完整动作：上传、下载、归档、权限范围、批量操作入口已完成；真实执行由 `rag-backend` 提供 API 后接入。
- [x] 智能搜索运营页：后台入口已完成；真实数据依赖 `rag-backend` 搜索运营 API。
- [x] AI 问答运营页：后台入口已完成；真实数据依赖 `rag-backend` 问答运营 API。
- [x] 知识图谱运营页：后台入口已完成；真实数据依赖 `rag-backend` 图谱运营 API。
- [x] 知识图谱运营三个二级菜单接口补齐：按 `admin/docs/graph-ops-menu-implementation-plan.md` 补 `nodes/:id`、`relations`、`relations/search`，并为 demo/mock 数据返回显式 meta，避免静默冒充真实图谱。

## 阻塞与红线

- 数据库 schema 变更、迁移、真实数据迁移：需要主人确认后才能做。
- `.env`、密钥、token、CI/CD、生产部署：不直接修改。
- `rag-backend` 搜索/问答运营 API 已就绪；Graph Ops 的 schema/entities/relationships/search 已补齐。当前真实 Neo4j 图谱为空时，admin-backend 会按显式 demo meta 返回演示数据。
- 忘记密码、MFA 需要外部通道（邮件/SMS），已按主人要求先放一放。
- 菜单持久化、菜单排序需要数据库 schema，已按主人要求先放一放。
- 当前不抽 `packages/shared`，`admin-backend` 自己维护 `rag-client/dto`。

## 最近验证

- 2026-09-23：管理接口授权与认证边界加固：公开注册固定普通角色；用户、订单、支付管理接口按现有角色权限码限制并过滤用户密码字段；JWT 增加 access/refresh 类型区分，登录和刷新拒绝停用账号，生产环境无数据库时拒绝启用内存演示用户。验证：`npm run verify` 通过（build、lint、unit 11 suites / 100 tests、e2e 2 suites / 19 tests、migration check）；lint 保留 3 条既有 warning。
- 2026-06-30：**组织权限联调基础接口完成**
  - 新增 `AdminOrganizationsController`，`GET /api/admin/organizations` 返回 4 个部门、4 个岗位和树形结构。
  - admin Documents 权限弹窗已接入该接口，部门主体从下拉选择，不再只手输 ID。
  - live 验证：登录 admin-backend 后请求 `/api/admin/organizations` 返回 200，`departments=4`、`positions=4`、`tree=4`。
  - 验证通过：`admin-backend npm run build`。
- 2026-06-25：**Graph Ops 三个二级菜单接口完成并联调**
  - admin-backend 新增/补齐：`GET /api/admin/graph-ops/nodes/:id`、`GET /api/admin/graph-ops/relations`、`GET /api/admin/graph-ops/relations/search`、`GET /api/admin/graph-ops/search`
  - `GraphOpsMockService` 补齐节点详情、关系列表、关系检索数据，并统一返回 `meta.demo=true`
  - `RagClientService` 补齐 graph entity detail、relationships search、graph search 调用
  - 真实联调：临时启动 rag-backend `3003`、admin-backend `3004`，登录后请求 stats/nodes/relations/relations-search/search 均返回 200；rag-backend 日志确认 entities/relationships/search 上游均为 200
  - 验证通过：`pnpm run build`、`pnpm run lint`、`pnpm exec jest --runInBand`（8 suites / 68 tests）、`pnpm run migration:check`
  - 2026-06-30 更新：`npm run verify` 已修复并通过；脚本改用 npm 执行，`UserService` 内存默认用户初始化竞态已消除，build/lint/unit/e2e/migration check 全链路通过。
- 2026-06-25：`/graph-ops` 三个二级菜单接口计划完成
  - 计划文件：`admin/docs/graph-ops-menu-implementation-plan.md`
  - 明确 admin-backend 需补 `nodes/:id`、`relations`、`relations/search`
  - 本次仅更新文档，未编码，未运行 `npm run verify`
- 2026-06-23：`naming-ok`、`package-name-ok`、`clean-ok` 通过。
- 2026-06-23：`npm ci` 成功安装本地依赖；存在 class-validator peer warning 和若干 deprecated warning，但命令成功。
- 2026-06-23：`npm run build` 通过。
- 2026-06-23：`npm run lint` 通过。
- 2026-06-23：`npm test -- --runInBand` 通过，4 个 test suites、26 个 tests。
- 2026-06-23：`npm run verify` 通过，包含 build、lint、unit、e2e、migration check；E2E 1 个 suite、9 个 tests 通过，migration checks passed。
- 2026-06-23：验证后已清理 `node_modules/`、`dist/`、`build/`、`coverage/`、`tsconfig.tsbuildinfo` 本地生成物。
- 2026-06-23：账号安全基础版、菜单管理基础版、审计标记、文档治理动作入口、搜索/问答/图谱运营入口补齐后，`npm run verify` 再次通过；验证后已清理本地生成物。
- 2026-06-23：`rag-backend` 已实现 `GET/POST /api/v1/rag/admin/*` 完整运营 API（capabilities/documents/chunks/vector-index/evaluations/conversations/reindex/search/qa/graph），解除 admin-backend RAG 运营入口的核心阻塞。`rag-backend` build/lint/test（103 tests）通过。
- 2026-06-24：`rag-backend` 新增 gRPC server（50051 端口），admin-backend 新增 `RagGrpcClientService`（VectorSearch/GetDocument/ListDocuments/HealthCheck），4 个 RPC 全部真实数据验证通过。
- 2026-06-24：`rag-backend` 新增 `query_logs` 表与 `QueryLogService`，search/QA 运营 API 返回真实分析数据（热门 query、无结果 query、召回问题、成本统计），不再返回 `not_implemented`。
- 2026-06-24：通知持久化完成：新增 `Notification` entity，Service 支持 TypeORM + 内存回退双模式；大盘真实趋势接入：`AdminDashboardService` 通过 `RAG_SERVICE_TOKEN` 拉取热门 query/成本统计/文档数/评测结果。验证通过：`npm run build`、`npm test -- --runInBand`（26 tests）通过。
- 2026-06-24：**admin-backend 接入 rag-backend upstream 完成**：
  - rag-backend 在 3000 端口运行，健康检查通过。
  - admin-backend 在 3002 端口运行（NODE_ENV=test），登录认证通过（内存模式默认用户 admin/Admin@123）。
  - rag-client 修正 Authorization header 格式（`Bearer ${token}`）。
  - search-ops/qa-ops/graph-ops overview 全部返回真实数据：
    - 热门查询：什么是NestJS（3次）、LangChain是什么（1次）、向量数据库有哪些（1次）
    - 召回问题：LangChain是什么（avgCitations=0）
    - 图谱 schema：nodeCount=0（Neo4j 暂无数据）
  - 单元测试新增 rag-client.service.spec.ts（9 tests）、search-ops.controller.spec.ts（8 tests），总计 43 tests 全部通过。
  - gRPC 模块已禁用（proto 文件缺失），使用 HTTP rag-client 替代。
- 2026-06-24：**E2E 场景补充完成**：新增 `test/operations.e2e-spec.ts` 独立测试套件，覆盖 search-ops、qa-ops、graph-ops、dashboard overview、documents management、notifications、system config 及权限控制；10 个测试用例全部通过。
- 2026-06-24：**QA AG-UI 流式代理完成**：新增 `GET /api/admin/qa-ops/agui/stream`，由管理后台鉴权后通过 `RAG_SERVICE_TOKEN` 转发到 rag-backend `GET /api/v1/agui/admin/stream`；`LoginGuard` 支持 EventSource `?token=` 鉴权；`RagClientService.streamAgui()` 固化 upstream URL、service token header 与 AbortSignal。验证通过：`npm run build`、`npm test -- --runInBand`（7 suites / 45 tests）。
- 2026-06-24：**AG-UI 配置与异常兜底补齐**：`.env.example` 增加 `RAG_SERVICE_BASE_URL/RAG_SERVICE_TIMEOUT_MS/RAG_SERVICE_TOKEN`；`QaOpsController.streamAgui()` 捕获 upstream 连接、状态异常和 reader 读取异常，失败时输出 `RUN_ERROR` SSE 并关闭连接；README 增加管理后台 AG-UI 代理说明。验证通过：`npm run build`、`npm test -- --runInBand`。
  - 内存模式用户初始化补齐 permissions 字段，admin 用户拥有全部 22 个权限。
- 2026-06-24：**QA AG-UI 代理友好兜底完成**：`QaOpsController.streamAgui()` 将 rag-backend 不可达、upstream 401/token 不匹配等代理层异常从 `RUN_ERROR` 升级为正常 AG-UI 消息流，返回 `RUN_STARTED`、`TEXT_MESSAGE_CONTENT`、`RUN_FINISHED` 和 `route=proxy-fallback`，避免 `/qa-ops` 页面直接展示 `错误：fetch failed`；admin 前端 EventSource 网络错误文案补充为 admin-backend 未启动或代理不可访问的明确提示。验证通过：`pnpm run build`、`pnpm exec jest --runInBand`（7 suites / 45 tests）、`cd ../admin && pnpm run lint`（通过，保留既有 dashboard 未使用变量 warning）；真实 curl 验证 rag-backend 3000 未监听时，`GET /api/admin/qa-ops/agui/stream?...` 返回友好提示和 `RUN_FINISHED`，未返回 `RUN_ERROR`。
- 2026-06-24：**AG-UI 真实代理链路复验完成**：
  - rag-backend 在 3000 端口运行，`GET /api/v1/health` 返回 200。
  - admin-backend 在 3001 端口运行，`GET /health` 返回 200，内存模式默认用户 `admin/Admin@123` 登录成功。
  - `GET /api/admin/qa-ops/agui/stream?query=...&mode=simple&token=...` 真实代理到 rag-backend `GET /api/v1/agui/admin/stream`。
  - SSE 返回 `RUN_STARTED`、`TEXT_MESSAGE_START`、`STATE_DELTA`、`CUSTOM(rag.final)`、`TEXT_MESSAGE_END`、`RUN_FINISHED`，证明 EventSource query token、管理后台 JWT、内部 `RAG_SERVICE_TOKEN` 三段鉴权链路均可用。
- 2026-06-24：**QA AG-UI SSE 超时断流修复完成**：定位 `/qa-ops` 查询 `nestjs` 时只输出到 `retrieval/sufficiency` 后报 `AG-UI 流式连接失败` 的根因是 `CircuitBreakerInterceptor` 对所有请求统一 `timeout(5000)`，长耗时 SSE 在生成阶段被 admin-backend 自己截断；已对 `Accept: text/event-stream` 和 `/agui/stream` 请求跳过 5 秒超时，普通 API 仍保留熔断超时保护。验证通过：`pnpm run build`、`pnpm exec jest --runInBand`（7 suites / 45 tests）、统一 `RAG_SERVICE_TOKEN` 后通过 `localhost:8000/api/admin/qa-ops/agui/stream?query=nestjs&mode=agentic` 验证输出 `TEXT_MESSAGE_CONTENT -> rag.final -> TEXT_MESSAGE_END -> RUN_FINISHED`，不再断流。
