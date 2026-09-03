# 任务清单：文档版本原子切换与后台治理入口

## T001：实现 RAG 后端草稿创建与版本切换

- 依赖：无
- 允许文件：`backend/src/modules/document/document.service.ts`、`backend/src/modules/rag-admin/rag-admin.service.ts`、`backend/src/modules/rag-admin/rag-admin.controller.ts`、`backend/src/modules/rag-admin/rag-admin.service.spec.ts`
- 操作：将新版本默认状态改为 `draft`；实现目标版本生效与同链版本废弃；回滚复用切换逻辑。
- 对应 AC：AC-01、AC-02、AC-03
- 验证：`pnpm --filter backend test -- rag-admin.service.spec.ts --runInBand`
- 完成定义：版本切换规则有定向测试，且后端类型检查通过。
- 状态：pending

## T002：接入管理后台代理与版本治理页面

- 依赖：T001
- 允许文件：`admin-backend/src/modules/rag-client/rag-client.service.ts`、`admin-backend/src/modules/admin-documents/admin-documents.controller.ts`、`admin/src/pages/documents/service.ts`、`admin/src/pages/documents/index.tsx`
- 操作：新增生效切换代理与页面按钮、成功提示和加载态。
- 对应 AC：AC-02、AC-04
- 验证：`pnpm --filter admin-backend exec tsc --noEmit && pnpm --filter admin exec tsc --noEmit && pnpm --filter admin build`
- 完成定义：管理员可从版本弹窗触发生效切换，前后端均通过类型与构建验证。
- 状态：pending

## T003：同步文档与完成验证

- 依赖：T001、T002
- 允许文件：`docs/interview/功能步骤流程.md`、`ROADMAP.md`、`specs/001-version-lifecycle-switch/verify.md`
- 操作：修订版本治理流程，记录验证结果。
- 对应 AC：AC-01、AC-02、AC-03、AC-04
- 验证：`pnpm --filter backend exec tsc --noEmit && pnpm --filter backend build && git diff --check -- backend/src/modules/document/document.service.ts backend/src/modules/rag-admin/rag-admin.service.ts backend/src/modules/rag-admin/rag-admin.controller.ts backend/src/modules/rag-admin/rag-admin.service.spec.ts admin-backend/src/modules/rag-client/rag-client.service.ts admin-backend/src/modules/admin-documents/admin-documents.controller.ts admin/src/pages/documents/service.ts admin/src/pages/documents/index.tsx docs/interview/功能步骤流程.md ROADMAP.md`
- 完成定义：流程口径与代码一致，验证记录完整。
- 状态：pending
