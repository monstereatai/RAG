# 实施计划：LLM 失败保护与多问题路由修复

## 已确认上下文

- `QwenLlmProvider` 与 `DeepseekLlmProvider` 在异常时返回带 Prompt 的 Mock 文本；`ZhipuLlmProvider` 已抛出错误。
- `QueryIntentRouter` 仅返回单意图；`AgenticRagService.run` 对高置信客观事实会在 Auto、Simple、Agentic 前直接回答。

## 方案

- Provider 失败时记录 error 指标并抛出统一的可识别错误，不构造任何回答文本。
- 语义路由输出 `multiIntent` 与最多五个 `subQueries`；模型遗漏多问题字段时，仅按明确问号边界保留完整问句，不使用关键词猜测；路由异常时统一返回 general。
- `AgenticRagService` 对多问题输入强制使用 Agentic 路径，跳过单题直答与 Auto 快速直答，由已有查询规划节点完成拆解。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `backend/src/providers/llm/llm-invocation.error.ts` | 新增 | 提供不含 Prompt 的 Provider 错误类型 | AC-01 |
| `backend/src/providers/llm/qwen-llm.provider.ts` | 修改 | 移除 Mock 回答回退 | AC-01 |
| `backend/src/providers/llm/deepseek-llm.provider.ts` | 修改 | 移除 Mock 回答回退 | AC-01 |
| `backend/src/rag/prompts/query-intent-router.ts` | 修改 | 输出多问题语义标记并保守降级 | AC-02、AC-03 |
| `backend/src/rag/agentic/agentic-rag.service.ts` | 修改 | 多问题强制 Agentic，捕获直答模型错误 | AC-01、AC-02 |
| `backend/src/providers/llm/qwen-llm.provider.spec.ts` | 修改 | 验证无 Mock 回答 | AC-01 |
| `backend/src/rag/prompts/query-intent-router.spec.ts` | 新增 | 验证路由解析和保守降级 | AC-03 |
| `backend/src/rag/agentic/agentic-rag.service.spec.ts` | 修改 | 验证多问题不走快速直答 | AC-02 |
| `ROADMAP.md` | 修改 | 记录验证后的真实进度 | AC-01、AC-02、AC-03 |

## 执行顺序

1. 修复 Provider 失败边界与单测。
2. 扩展语义路由契约并添加路由单测。
3. 接入多问题 Agentic 门禁，补服务单测。
4. 执行定向测试、后端构建、真实 SSE 验证并更新路线图。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| unit | `pnpm --dir backend exec jest --runInBand src/providers/llm/qwen-llm.provider.spec.ts src/rag/prompts/query-intent-router.spec.ts src/rag/agentic/agentic-rag.service.spec.ts` | 定向测试通过 |
| build | `pnpm --dir backend run build` | 退出码为 0 |
| smoke | AG-UI SSE 模拟多问题输入与模型失败边界 | 无 Mock／Prompt 泄露；多问题进入 agentic |
| diff | `git diff --check` | 无格式错误 |

## 执行控制

- 状态恢复：off
- 独立审查：off
- 分支策略：当前分支
- 提交策略：none

## 风险与回退

- 风险：模型不可用时不再伪造答案，页面将收到明确错误事件。
- 回退方式：恢复本次涉及源码文件的前一提交；不涉及数据和配置。

## 审批

- Plan 状态：approved
- 批准人：主人
- 批准时间：2026-09-09
