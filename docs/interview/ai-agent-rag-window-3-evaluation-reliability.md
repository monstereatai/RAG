# 执行窗口 3：评测、可观测与运行可靠性

本任务单供主人在第 3 个 Codex 窗口执行。它拆分自[当前缺口清单](./ai-agent-rag-missing-and-optimization-checklist.md)，不替代原清单；以原清单和当前源码为准。

## 负责范围

- 技术栈模块：T15–T16、T25–T35。
- 项目级 P0 评测集、指标、Judge 与 bad-case 回归中属于评测/指标系统的代码部分。
- P1 Redis/BullMQ、Agent Run 恢复、预算/Token 指标、API 流式生命周期和多索引运行恢复。
- 第 5 节真实评测门禁、预算/用量/取消、运行可靠性和质量门禁优化项。

## 独占源码范围

- `apps/rag-api/src/modules/agent-evals/`
- `apps/rag-api/src/modules/evaluation-reports/`
- `apps/rag-api/src/modules/agent-runs/`
- `apps/rag-api/src/modules/agent-runtime-events/`
- `apps/rag-api/src/modules/jobs/`
- `apps/rag-api/src/modules/metrics/`
- `apps/rag-api/src/modules/tracing/`
- `apps/rag-api/src/modules/agui/`
- `apps/rag-api/src/modules/structured/`
- `apps/rag-api/src/modules/rag-gateway/`
- `apps/rag-api/src/providers/embedding/`
- `apps/rag-api/src/providers/multimodal-embedding/`
- `apps/rag-api/src/providers/vision/`
- `apps/rag-api/scripts/` 中评测与 smoke 实现
- `apps/admin-api/src/tracing/`
- `apps/admin-api/src/modules/qa-ops/`
- `apps/admin-api/src/modules/rag-client/`

不要修改窗口 2 负责的文档/向量/ES/Mem0/RAG 检索源码、窗口 1 的 Agent/工具源码、窗口 4 的 Admin Web/Sandbox/权限 DTO。

## 当前已知实现，避免重复造轮子

- AgentRun stale 取消待办已用 `cancelSignalPending` 持久化，本机 32 个源码迁移已应用；目标环境与重启恢复仍需验证。
- BullMQ 8 个队列已有水位、最老等待时间、事件速率和耗时指标；本地 smoke 覆盖部分重试、去重和 Worker stalled 恢复。
- Admin→RAG QA SSE 已传 `traceparent`/`x-request-id`；RAG Agent span 关联 HTTP trace，AG-UI 事件沿用 request ID。
- Structured Report SSE 已把断线 AbortSignal 传给模型流；`at` 定时任务 stop/delete 已移除尚未开始的 one-shot delayed job，active job 保持运行。
- Embedding、Vision 的实际 usage 指标已有实现，Qwen embedding 明确请求 float 编码；评测数据关键字段校验拒绝空/重复关键词。
- 用户要求暂不运行单测；历史 Jest 状态见主清单，不能宣称当前全量 Jest 通过。

## 执行规则

1. 先检查 `git status --short` 和目标文件现有 diff；四个窗口共享工作树，不得重置或覆盖其他窗口的改动。
2. 只修可由本地源码/锁定 SDK 契约确定的功能问题。涉及队列副作用重试时先证明幂等，不要为了重试而重放有副作用任务。
3. 不运行单测。目标文件 lint、静态脚本检查可运行；避免在并行编辑时执行共享 `dist/` 的全量 build。
4. 结束后报告改动、静态验证、需真实数据/目标服务才能证明的指标。ROADMAP 与总清单由主窗口统一合并。

## 外部前置，不得标成已完成

真实金标准、人工校准 Judge、线上 bad case/用户反馈、Provider 账单对账、目标网关/Cloud trace、Redis 多实例/积压/重启及生产恢复演练需在对应目标环境完成。
