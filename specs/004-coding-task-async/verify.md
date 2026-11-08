# 验证记录：ZIP Workspace 异步 Coding Task

## 范围与 Diff

- T001、T002、T003 范围分别由 `scope-report-T001.json`、`scope-report-T002.json`、`scope-report-T003.json` 验证通过。
- 最终构建发现的 `production-workflow.control.ts` 最小兼容修复经主人批准，作为独立 fixup task 实施；`fixup/scope-report-T001.json` 通过。
- T004 发现并独立完成获批的 fixup 后，原始 baseline 已保留为 `scope-baseline-T004-pre-fixup.json`；T004 恢复时重新 capture 当前状态作为 `scope-baseline-T004.json`，后续仅跟踪该任务负责的文档与收尾操作。
- T004 baseline 将状态、命令日志、scope 工件和已独立完成的 fixup 工件设为内部记录；`tasks.md` 与本验收记录仍纳入 T004 白名单检查。
- 最终文件范围由 `scope-report-T004.json` 验证；fixup 源文件仍由 `fixup/scope-report-T001.json` 独立验证。
- 相关修改仅涉及 Coding Task 持久化/恢复/验收、管理端异步任务 UI、获批的 queue union 修复及项目状态文档。

## 自动验证

| 验证 | 命令／操作 | 结果 | 证据 ID |
| --- | --- | --- | --- |
| T001 后端定向 Jest | 见 `tasks.md` T001 | 通过 | `T001-unit-r2` |
| T002 Loop/Workspace 定向 Jest | 见 `tasks.md` T002 | 通过 | `T002-unit-r4` |
| Admin API 定向 Jest | `cd apps/admin-api && npm test -- --runInBand src/modules/agent-ops/agent-ops.controller.spec.ts` | 通过 | `T003-admin-api-unit` |
| Admin Web Hook 测试 | `pnpm --dir apps/admin-web exec vitest run src/pages/agent-ops/workflow-detail/workflow-detail-workspace-controller.spec.tsx` | 2 tests 通过 | `T003-web-unit` |
| Admin API TypeScript | `pnpm --dir apps/admin-api exec tsc --noEmit` | 通过 | `T004-admin-api-tsc` |
| Admin Web lint 与 TypeScript | `pnpm --dir apps/admin-web run lint` | 通过 | `T004-admin-web-lint` |
| RAG API build | `cd apps/rag-api && npm run build` | 首次发现 TS2339；修复后通过 | `T001-rag-build`（修复后）、`T004-rag-build-r2` |
| Dispatch contract | `cd apps/rag-api && npm test -- --runInBand src/modules/workflow/workflow-dispatch-contract.spec.ts` | 通过 | `T001-dispatch-unit` |
| Diff whitespace | `git diff --check` | 通过 | `T004-diff-check-r2` |

## 验收标准追踪

| AC | 结果 | 验证证据 | 备注 |
| --- | --- | --- | --- |
| AC-01 | 通过 | T001 定向 Jest、Admin API 测试、RAG build | 异步受理、requestId 幂等及 owner/tenant 路由已覆盖。 |
| AC-02 | 通过 | T001/T002 定向 Jest、dispatch contract、RAG build | Task/Run/Outbox 队列与同 Run 恢复已实现；误入普通 Workflow processor 的 coding_task 明确拒绝。 |
| AC-03 | 通过 | T001/T002 定向 Jest | 任务终态、取消与迟到结果保护已有测试。 |
| AC-04 | 通过（代码与 mock 测试） | T002 定向 Jest | ZIP manifest 差异及脚本状态显式区分；没有真实 Sandbox 运行证据。 |
| AC-05 | 通过 | T003 Admin API Jest、Admin Web Hook 测试、typecheck、lint | 异步提交、轮询、取消、续跑及结果展示已接入。 |

## 例外与风险

- OpenSandbox E2E 按主人要求暂缓：当前没有可用 API key/目标环境；本次不宣称真实 ZIP 沙箱验收通过。
- Migration 已创建但未执行；本次未连接或修改数据库。
- 未提交、推送、合并或部署。
- T004 最终 baseline 只在获批 fixup 的独立 scope 验证完成后重新 capture；旧 baseline 保留以追踪最初 build 失败时的范围快照。

## 结论

- 本地实现与自动验证：完成。
- OpenSandbox、数据库 migration 应用、Git Provider/PR/CI 交付：待后续环境与单独切片。
