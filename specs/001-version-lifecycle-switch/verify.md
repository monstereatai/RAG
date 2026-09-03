# 验证记录：文档版本原子切换与后台治理入口

## 范围与 Diff

- 计划内文件：RAG 后端版本服务与接口、Admin Backend 代理、管理后台版本弹窗、流程文档与 ROADMAP。
- 实际新增涉改文件：`backend/src/modules/rag-admin/rag-admin.service.spec.ts`；其余为计划内修改。
- 范围门禁：pass。
- 无关改动：`.obsidian/workspace.json` 是编辑器自动写入的已有工作区配置，未由本次逻辑修改；已有 `admin-backend/.env.production` 末尾空行不在本次范围，未修改。

## 自动验证

| 验证 | 命令／操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| unit | `pnpm --filter backend test -- rag-admin.service.spec.ts --runInBand` | pass | `T001-unit` |
| typecheck／build | `pnpm --filter admin-backend exec tsc --noEmit && pnpm --filter admin exec tsc --noEmit && pnpm --filter admin build` | pass | `T002-build` |
| typecheck／build／diff | `pnpm --filter backend exec tsc --noEmit && pnpm --filter backend build && git diff --check -- <计划内文件>` | pass | `T003-backend-scoped` |
| 本地接口联调 | 创建草稿（1 Chunk）→设为生效→回滚原版本 | pass | `df06851f-9018-48f7-b8eb-b8e680dff918` |

## 结构化证据

- 状态文件：`specs/001-version-lifecycle-switch/state.json`。
- Scope 报告：`scope-report-T001.json`、`scope-report-T002.json`、`scope-report-T003.json`。
- 命令证据 ID：`T001-unit`、`T002-build`、`T003-backend-scoped`。
- stdout／stderr 日志路径：`specs/001-version-lifecycle-switch/evidence/`。
- Git HEAD：`e4028205df8d2e2131697f224b454f9a2700558b`。
- 最近通过检查的 Diff 哈希：`b0cb673228c00d242219dd52fd022195c6f3b8f4729bbc02e3e2450958cf854a`。

## 验收标准追踪

| AC | 结果 | 验证证据 | 备注 |
| --- | --- | --- | --- |
| AC-01 | pass | `T001-unit`、本地接口联调 | 新版本创建固定为 `draft`，不再在上传期间废弃旧版本。 |
| AC-02 | pass | `T001-unit`、`T003-backend-scoped`、本地接口联调 | 生效接口校验目标版本并在 PostgreSQL 事务中切换同链生命周期。 |
| AC-03 | pass | `T001-unit`、本地接口联调 | 回滚复用同一生效切换服务。 |
| AC-04 | pass | `T002-build`、页面代码审阅 | 版本弹窗按状态提供「设为生效」「废弃」或「回滚到此版本」。 |

## 例外与风险

- 未运行验证及原因：未通过管理后台浏览器页面操作；当前本地管理后台无可用演示登录凭据。RAG 后端真实接口联调已完成。
- 已知限制：PostgreSQL 生命周期切换是原子事务；Elasticsearch 与 Karpathy 在事务提交后同步，外部索引同步失败会返回错误，但不具备跨服务分布式事务。
- 后续事项：上线前以真实版本链执行一次草稿索引、设为生效、废弃和回滚的接口／页面联调。

## 结论

- 状态：ready_for_review。
- 审查人：Codex。
- 审查时间：2026-08-31。
- 人工验收证据：待主人在后台页面确认后记录。
