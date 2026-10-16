# 实施计划：图片以图搜图

## 已确认上下文

- 管理端已有文搜图页及 `/api/admin/images` 代理模块。
- RAG 端已有统一多模态 embedding、Milvus 图片索引、文搜图和有效文档 ACL。
- 工作区在 `main` 分支且有大量已有未提交改动；本次只做增量修改，不重置或切换分支。

## 方案

- 数据流：浏览器 multipart 上传 → Admin Backend 验证登录身份并附加服务令牌 → RAG Backend 验证图片并派生 base64 → 图片 embedding → Milvus 相似图片召回 → 当前 user／tenant／role 的生效文档 ACL 过滤 → Admin Backend 转换图片代理 URL → 页面展示。
- API：沿用 `POST /api/admin/images/search`；新增内部 `POST /api/v1/rag/admin/images/search`。两端均限制 5 MB。
- 查询图只参与本次 embedding，不写入图片集合。原 GET 文搜图继续使用。
- 回退：移除 POST 上传入口与 ImageIndexService 图片查询方法即可；不涉及持久数据和 schema。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `admin/src/pages/image-search/index.tsx` | modify | 增加文搜图／以图搜图切换和上传入口 | AC-01、AC-03、AC-04 |
| `admin/src/pages/image-search/service.ts` | modify | 提交 multipart 图片查询 | AC-01 |
| `admin-backend/src/modules/admin-images/admin-images.controller.ts` | modify | 验证图片、派生登录身份并代理查询 | AC-01、AC-02、AC-03 |
| `admin-backend/src/modules/admin-images/admin-images.controller.spec.ts` | modify | 验证身份来源、权限和请求拒绝 | AC-02、AC-03 |
| `admin-backend/src/modules/rag-client/rag-client.service.ts` | modify | 带内部令牌转发 multipart 请求 | AC-01、AC-02 |
| `admin-backend/src/modules/rag-client/rag-client.service.spec.ts` | modify | 验证 multipart 与调用身份转发 | AC-01、AC-02 |
| `backend/src/modules/rag-admin/rag-admin.controller.ts` | modify | 新增受服务令牌保护的图片上传检索路由 | AC-01、AC-03 |
| `backend/src/modules/rag-admin/rag-admin.controller.spec.ts` | modify | 验证请求转发、文件和 MIME 校验 | AC-01、AC-03 |
| `backend/src/modules/rag-admin/rag-admin.service.ts` | modify | 复用当前有效文档 ACL 并调用图片向量检索 | AC-01、AC-02 |
| `backend/src/modules/rag-admin/rag-admin.service.spec.ts` | modify | 验证 user／tenant／role ACL 上下文 | AC-02 |
| `backend/src/modules/image-index/image-index.service.ts` | modify | 图片 embedding 和受 ACL 约束的向量召回 | AC-01、AC-02、AC-03 |
| `backend/src/modules/image-index/image-index.service.spec.ts` | modify | 验证图片嵌入、结果过滤和不写索引行为 | AC-02、AC-03 |
| `ROADMAP.md` | modify | 记录已验证进度和限制 | AC-01–AC-04 |
| `docs/README.md` | modify | 登记本功能方案与验证记录 | AC-01–AC-04 |
| `docs/plans/image-to-image-search-{spec,plan,tasks,verify}.md` | add | 记录需求、批准方案、执行任务和验证证据 | AC-01–AC-04 |

## 执行顺序

1. RAG 图片向量查询、服务权限过滤和内部 POST API。
2. Admin Backend 登录态代理与 multipart 转发。
3. 管理端页面增加图片上传查询入口。
4. 跑定向测试、三端构建与可用的代码检查，复核 diff 并更新 Roadmap。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| Backend unit | `pnpm --dir backend exec jest --runInBand src/modules/image-index/image-index.service.spec.ts src/modules/rag-admin/rag-admin.controller.spec.ts src/modules/rag-admin/rag-admin.service.spec.ts src/modules/rag-admin/rag-admin.image-assets.spec.ts` | 相关测试通过 |
| Admin Backend unit | `pnpm --dir admin-backend exec jest --runInBand src/modules/admin-images/admin-images.controller.spec.ts src/modules/rag-client/rag-client.service.spec.ts` | 相关测试通过 |
| Backend build | `pnpm --dir backend build` | 退出码 0 |
| Admin Backend build | `pnpm --dir admin-backend build` | 退出码 0 |
| Admin build | `pnpm --dir admin build` | 退出码 0 |
| Admin lint | `pnpm --dir admin exec biome lint src/pages/image-search/index.tsx src/pages/image-search/service.ts` | 退出码 0 |
| Diff | 对本次涉改文件运行 `git diff --check` | 无空白错误 |

## 执行控制

- 状态恢复：off
- 独立审查：off
- 分支策略：当前分支
- 提交策略：none

## 风险与回退

- 真实模型和 Milvus 的端到端效果依赖运行环境配置，本轮只验证 mock 链路和构建。
- 浏览器和两段服务各限制 5 MB；若部署网关另有限制，运行环境仍需单独核对。

## 审批

- Plan 状态：approved
- 批准人：主人
- 审批证据：用户回复“按此方案实施”。
