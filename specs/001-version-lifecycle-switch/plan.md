# 实施计划：文档版本原子切换与后台治理入口

## 已确认上下文

- `RagAdminService.createDocumentVersion` 当前默认创建 `effective` 新版本；`DocumentService.upload` 会在写入中途废弃 `supersedesDocId` 指向的旧版本。
- RAG 后端已存在创建版本、改生命周期、回滚接口，Admin Backend 已有代理，前端已有版本治理弹窗；但没有独立「设为生效」入口。
- 当前分支为受保护的 `main`，工作区已有用户修改；本次不创建或切换分支，不提交。

## 方案

- 创建版本固定为 `draft`，不在上传过程中废弃旧版本。
- 新增受控的版本切换服务：校验目标版本与版本链、Chunk 完整性；在 PostgreSQL 事务内将目标设为 `effective`、同链其他版本设为 `deprecated`；事务提交后同步 ES 与 Karpathy。
- 生效与回滚共用该服务；Admin Backend 仅代理 RAG 后端接口并写审计日志。
- 前端版本弹窗新增「设为生效」按钮；创建版本提示改为「创建草稿，完成索引后再设为生效」。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `backend/src/modules/document/document.service.ts` | modify | 去除上传中自动废弃；实现事务化版本切换 | AC-01、AC-02、AC-03 |
| `backend/src/modules/rag-admin/rag-admin.service.ts` | modify | 新版本默认草稿；调用版本切换服务 | AC-01、AC-02、AC-03 |
| `backend/src/modules/rag-admin/rag-admin.controller.ts` | modify | 暴露生效切换接口 | AC-02 |
| `admin-backend/src/modules/rag-client/rag-client.service.ts` | modify | 代理生效切换请求 | AC-02 |
| `admin-backend/src/modules/admin-documents/admin-documents.controller.ts` | modify | 权限与审计代理入口 | AC-02 |
| `admin/src/pages/documents/service.ts` | modify | 调用生效切换接口 | AC-04 |
| `admin/src/pages/documents/index.tsx` | modify | 版本弹窗展示并执行生效操作 | AC-04 |
| `backend/src/modules/rag-admin/rag-admin.service.spec.ts` | add/modify | 覆盖草稿创建和版本切换规则 | AC-01、AC-02、AC-03 |
| `docs/interview/功能步骤流程.md` | modify | 修订第十章版本切换口径与流程 | AC-01、AC-02 |
| `ROADMAP.md` | modify | 同步已验证进度 | AC-01、AC-02、AC-03、AC-04 |

## 执行顺序

1. 完成 RAG 后端版本创建与事务化切换，并补服务测试。
2. 接入 RAG Controller、Admin Backend 代理和前端版本弹窗。
3. 更新流程文档与 ROADMAP，运行后端／管理后台／前端验证。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| backend unit | `pnpm --filter backend test -- rag-admin.service.spec.ts --runInBand` | 版本创建／切换／回滚用例通过 |
| backend typecheck | `pnpm --filter backend exec tsc --noEmit` | 退出码为 0 |
| backend build | `pnpm --filter backend build` | 退出码为 0 |
| admin backend typecheck | `pnpm --filter admin-backend exec tsc --noEmit` | 退出码为 0 |
| admin typecheck | `pnpm --filter admin exec tsc --noEmit` | 退出码为 0 |
| admin build | `pnpm --filter admin build` | 退出码为 0 |
| diff | `git diff --check -- backend/src/modules/document/document.service.ts backend/src/modules/rag-admin/rag-admin.service.ts backend/src/modules/rag-admin/rag-admin.controller.ts backend/src/modules/rag-admin/rag-admin.service.spec.ts admin-backend/src/modules/rag-client/rag-client.service.ts admin-backend/src/modules/admin-documents/admin-documents.controller.ts admin/src/pages/documents/service.ts admin/src/pages/documents/index.tsx docs/interview/功能步骤流程.md ROADMAP.md` | 计划内文件无格式错误；不检查已有环境配置改动 |

## 执行控制

- 状态恢复：on
- 独立审查：off
- 分支策略：当前分支
- 提交策略：none

## 风险与回退

- 风险：ES／Karpathy 生命周期同步不属于 PostgreSQL 事务。
- 回退：通过既有版本切换／回滚操作将上一版本重新设为 `effective`；不删除任何版本或原始资料。

## 审批

- Plan 状态：approved
- 批准人：主人
- 审批证据：用户明确回复「可以」。
