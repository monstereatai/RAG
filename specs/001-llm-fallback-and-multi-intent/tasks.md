# 任务清单：LLM 失败保护与多问题路由修复

## T001：移除 Provider Mock 回答

- 依赖：无
- 允许文件：`backend/src/providers/llm/llm-invocation.error.ts`、`backend/src/providers/llm/qwen-llm.provider.ts`、`backend/src/providers/llm/deepseek-llm.provider.ts`、`backend/src/providers/llm/qwen-llm.provider.spec.ts`
- 操作：失败时抛出不含 Prompt 的 Provider 错误，并验证不会返回 Mock 文本。
- 对应 AC：AC-01
- 验证：`pnpm --dir backend exec jest --runInBand src/providers/llm/qwen-llm.provider.spec.ts`
- 状态：done（Provider 编译产物故障注入验证通过；Jest 受既有运行时冲突阻断）

## T002：扩展多问题语义路由

- 依赖：T001
- 允许文件：`backend/src/rag/prompts/query-intent-router.ts`、`backend/src/rag/prompts/query-intent-router.spec.ts`
- 操作：输出多问题语义标记，路由异常时保守降级为 general。
- 对应 AC：AC-03
- 验证：`pnpm --dir backend exec jest --runInBand src/rag/prompts/query-intent-router.spec.ts`
- 状态：done（编译产物语义路由验证通过；Jest 受既有运行时冲突阻断）

## T003：多问题强制深度链路并验证

- 依赖：T002
- 允许文件：`backend/src/rag/agentic/agentic-rag.service.ts`、`backend/src/rag/agentic/agentic-rag.service.spec.ts`、`ROADMAP.md`
- 操作：跳过单题直答／Auto 快速直答，进入 Agentic 查询规划；完成构建与 SSE 验证后同步路线图。
- 对应 AC：AC-01、AC-02、AC-03
- 验证：`pnpm --dir backend exec jest --runInBand src/rag/agentic/agentic-rag.service.spec.ts`、`pnpm --dir backend run build`
- 状态：done（TypeScript、构建与编译产物门禁验证通过；Jest 受既有运行时冲突阻断）
