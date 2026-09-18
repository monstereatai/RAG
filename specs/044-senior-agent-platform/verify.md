# 验证记录：高级 Agent 平台能力补齐

验证时间：2026-09-18

## 已通过

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| Agent Runtime 取消／检查点／重试 | 通过 | `T001-unit-rerun2`；Agent Loop 与 Agent Runs 单测通过 |
| 审批／驳回／局部恢复／工具幂等 | 通过 | 审批工作流、工具执行和 Agent Runtime 专项测试 19／19 |
| 三链路确定性质量门禁 | 通过 | `T002-eval`；路由 12／12，Agent Task 和 Production Workflow 门禁通过 |
| Trace 持久化与降级 | 通过 | `T003-unit`；Tracing 单测 4／4，Backend build 通过 |
| CI 质量门禁 | 通过 | `.github/workflows/quality-gate.yml` 已执行 `eval:agent-platform` |
| 文档与 Diff | 通过 | `T004-final`；Chat 三模式集成测试、Backend build、`git diff --check` 通过 |

## 三链路真实入口回放

统一脚本默认使用相同的 `/api/v1/chat` 入口请求 `simple`、`auto`、`agentic`：

```bash
cd backend
AGENT_PLATFORM_REQUIRE_LIVE=true npm run eval:agent-platform
```

2026-09-18 已在 Docker 依赖启动后重新执行：PostgreSQL、Redis 可用，后端 `/api/v1/health` 返回 200，且三种模式均通过真实 `/api/v1/chat` 入口返回 HTTP 201。针对内部差旅制度问题，三种模式均命中内部 RAG 并返回 2026 年一线城市 650 元的结论，引用数量分别为 Simple 6、Auto 6、Agentic 5。

另一个「混合检索 RRF 重排引用流程」问题用于验证证据门禁差异：Simple 因引用约束未通过而安全降级，Auto 返回带 3 条引用的完整回答，Agentic 因当前证据不足而安全降级。该结果符合“无可靠证据不编造”的约束，但也说明三链路的证据覆盖仍需继续补充。

完整 11 文档、三模式项目评测未宣称通过：上传阶段 Milvus 容器反复重启，接口返回 `14 UNAVAILABLE`，因此项目评测明确记为 `skipped/blocked`，没有把依赖故障伪装成质量通过。Milvus 稳定后需重新执行上述命令，才能形成完整数据集的三链路证据。

## 迁移说明

- `1787800000000-AddAgentRuntimeControls.ts`：Agent Run 取消和检查点字段。
- `1787900000000-AddTraceSpans.ts`：Trace span 持久化表和索引。
- `1788000000000-UsePrecisionForTraceSpanDuration.ts`：将 Trace span 时长改为 `double precision`，支持小数耗时持久化。
- 本地数据库已执行 `npm run migration:run`，23 个迁移全部为已应用状态；Trace span 小数耗时已能提交并提交事务。

## 结论

代码、确定性门禁、审批恢复测试、构建、迁移和三模式真实入口抽样回放均已验证。完整项目评测仍受 Milvus 不稳定阻塞，不能宣称完整真实 E2E 已通过；需先恢复 Milvus 稳定性，再重跑上传和三模式全量评测。
