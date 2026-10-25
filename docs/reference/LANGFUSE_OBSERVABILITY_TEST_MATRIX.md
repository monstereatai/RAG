# Langfuse 可观测性测试矩阵

> 适用范围：`backend/src/providers/observability/langfuse.provider.ts` 及其 trace、generation、span、usage、redaction 和 disabled contract。
>
> 数据集：`backend/eval/langfuse-observability.dataset.json`
>
> 执行器：`backend/scripts/eval-langfuse-observability.mjs`
>
> 生成器：`backend/scripts/generate-langfuse-observability-dataset.mjs`

## 1. 结论边界

这套测试是 **Langfuse 采集契约回归**，不是 Langfuse 云端真实项目验收。

- 使用本地 mock ingestion endpoint 接收 Langfuse SDK 实际发送的 batch。
- 直接实例化真实的 `LangfuseProvider`，不是另写一套假 trace builder。
- 不依赖 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY`。
- 验证 trace/generation/span/event、token/cost、脱敏、fallback、生产工作流、定时分析和禁用契约。
- 真实云端 trace 是否出现在 Langfuse Dashboard，仍需配置真实 key 后运行 `smoke:langfuse` 人工或接口验收。

## 2. 数据集概览

当前数据集版本：`langfuse-observability-2026-10-18`

| 项目 | 数量 |
|---|---:|
| 场景数 | 19 |
| 测试方向 | 14 |
| 自动断言数 | 150 |
| 目标类型 | 5 |

目标类型：

- `rag_answer`：普通 RAG trace 和事件链路。
- `production_workflow`：生产多 Agent 工作流 trace。
- `scheduled_analysis`：定时分析任务 trace。
- `smoke`：启用状态 smoke。
- `disabled`：禁用或缺 key 契约。

## 3. 测试方向

### 3.1 Trace 生命周期

验证内容：

- trace 是否创建成功。
- trace name 是否符合预期。
- userId、sessionId、threadId 是否进入 trace。
- input、output 是否可观测。
- 不同目标类型是否使用正确的 trace name：
  - `rag.answer`
  - `agent.production.workflow`
  - `agent.scheduled.analysis`
  - `rag.observability.smoke`

对应场景：

- `rag-simple-citation`
- `rag-auto-multistep`
- `production-workflow-success`
- `scheduled-analysis-success`
- `smoke-enabled-contract`

### 3.2 RAG 三种模式

验证内容：

- `simple` 单次 RAG。
- `auto` 自动路由或升级 Agentic。
- `agentic` 多步检索。
- mode、route、model、latencyMs、citationCount 是否进入 metadata。

对应场景：

- `rag-simple-citation`
- `rag-auto-multistep`
- `rag-agentic-tool-and-web`

### 3.3 检索和引用事件

验证以下事件是否转换为 Langfuse span：

- `routing` → `rag.routing`
- `query_augment` → `rag.query_plan`
- `retrieval` → `rag.retrieval`
- `sufficiency` → `rag.sufficiency`
- `rerank` → `rag.rerank`
- `citation` → `rag.citation`
- `reflection` → `rag.reflection`
- `final` → `rag.final`

同时验证：

- span name 是否正确；
- event data 是否被压缩和脱敏；
- trace 中事件摘要数量是否合理。

对应场景：

- `rag-simple-citation`
- `rag-auto-multistep`
- `rag-version-conflict`
- `rag-error-fallback`

### 3.4 Web Search 和工具调用

验证内容：

- `web_search` 事件是否记录为 `rag.web_search` span。
- `tool_call` 事件是否记录为 `rag.tool_call` span。
- 工具名，例如 `bocha_web_search`，是否可追踪。
- 工具状态、fallback、错误信息是否进入 span output。

对应场景：

- `rag-agentic-tool-and-web`
- `rag-long-event-compaction`

### 3.5 无证据拒答

验证内容：

- `refused: true` 是否写入 trace metadata。
- `citationCount: 0` 是否正确。
- `references: []` 是否保持为空。
- 拒答路径是否仍然生成 trace 和 generation。

对应场景：

- `rag-refusal-no-evidence`

### 3.6 版本冲突

验证内容：

- 冲突回答是否记录多条 references。
- citationCount 是否准确。
- 版本冲突标记是否进入回答或 metadata。
- 多引用场景下 trace 是否仍可追踪。

对应场景：

- `rag-version-conflict`

### 3.7 Token 与成本

验证两种 usage 来源：

- `estimated`：由 query/answer 估算 token。
- `provider_reported`：使用真实 provider token 或显式 cost。

验证字段：

- `usageDetails.inputTokens`
- `usageDetails.outputTokens`
- `usageDetails.totalTokens`
- `costDetails.inputCostUsd`
- `costDetails.outputCostUsd`
- `costDetails.totalCostUsd`
- `usage.source`

对应场景：

- `rag-provider-reported-usage`
- `rag-estimated-token-cost`

### 3.8 内容脱敏

生产环境默认脱敏：

| 数据 | 期望 |
|---|---|
| `alice@example.com` | `[email]` |
| `13800138000` | `[phone]` |
| `Token abcdef123456` | `[credential]` |
| `6222021234567890123` | `[long-number]` |

验证：

- 敏感原文不出现在 mock ingestion batch 中。
- 脱敏占位符出现在 batch 中。
- trace query、answer 和 event data 都执行脱敏。

另验证 development 显式关闭脱敏：

- `redactContent=false`
- 原始 fixture 文本保留，用于确认脱敏是配置驱动行为。

对应场景：

- `rag-redaction-enabled`
- `rag-redaction-disabled-dev`
- `scheduled-analysis-redaction`

### 3.9 错误和 Fallback

验证内容：

- 模型超时是否进入 reflection 或 event。
- fallback 答案是否仍生成 trace。
- 错误事件的 span output 是否可观测。
- 最终 trace 是否包含失败、降级或 fallback 标记。

对应场景：

- `rag-error-fallback`
- `production-workflow-tool-error`

### 3.10 生产多 Agent 工作流

验证内容：

- `agent.production.workflow` trace。
- `agent.production.stage.<role>` span。
- `agent.production.generation.<role>` generation。
- `agent.production.tool.<tool>` event。
- `agent.production.workflow.finished` event。
- selectedRoles、completedRoles、pendingApprovalRoles。
- approvalMode、stepCount、maxSteps、stageCount。
- riskLevel、evidenceCoverage、claims、supportedClaims。
- issues、downstreamRisks、tool fallback 和错误信息。

对应场景：

- `production-workflow-success`
- `production-workflow-approval-pending`
- `production-workflow-tool-error`

### 3.11 定时分析任务

验证内容：

- `agent.scheduled.analysis` trace。
- `agent.scheduled.analysis.report` generation。
- jobId、name、instruction、window、dataScopes。
- snapshotCounts。
- report 内容脱敏。

对应场景：

- `scheduled-analysis-success`
- `scheduled-analysis-redaction`

### 3.12 Session 和 User 分组

验证内容：

- `userId` 是否进入 trace。
- `sessionId` 是否进入 trace。
- `threadId` 是否可用于会话聚合。
- jobId 是否作为定时任务 session。
- 多角色 workflow 是否共享同一个 threadId。

相关场景：

- `rag-simple-citation`
- `rag-auto-multistep`
- `production-workflow-success`
- `scheduled-analysis-success`

### 3.13 长事件数据压缩

验证内容：

- 字符串超过 500 字符时是否截断并追加 `...`。
- 数组是否转换为 count + sample。
- 对象字段是否限制为前 12 个。
- 超长结尾 marker 是否被截断。
- trace 仍然可正常发送。

对应场景：

- `rag-long-event-compaction`

### 3.14 启用和禁用契约

验证内容：

启用时：

- `status.enabled=true`
- `health.enabled=true`
- smoke 生成 trace 和 generation
- smoke `sent=true`

禁用或缺 key 时：

- `status.enabled=false`
- `health.enabled=false`
- smoke `sent=false`
- smoke reason 为 `langfuse_disabled_or_missing_keys`
- 不产生 ingestion batch

对应场景：

- `smoke-enabled-contract`
- `disabled-missing-keys`
- `disabled-explicit`

## 4. 场景清单

| 场景 ID | 类型 | 关键数据 | 主要验收 |
|---|---|---|---|
| `rag-simple-citation` | rag_answer | simple + 1 citation | trace、generation、routing/retrieval/citation/final span |
| `rag-auto-multistep` | rag_answer | auto + agentic + rerank | query plan、sufficiency、rerank、reflection |
| `rag-agentic-tool-and-web` | rag_answer | web search + tool call | rag.web_search、rag.tool_call |
| `rag-refusal-no-evidence` | rag_answer | 无引用拒答 | refused=true、references=[] |
| `rag-version-conflict` | rag_answer | 新旧版本冲突 | 多引用、citation、版本冲突 |
| `rag-provider-reported-usage` | rag_answer | provider_reported | usageDetails、costDetails |
| `rag-estimated-token-cost` | rag_answer | estimated usage | 估算 token 和 cost |
| `rag-long-event-compaction` | rag_answer | 800 字符工具事件 | 长文本截断、数组压缩 |
| `rag-redaction-enabled` | rag_answer | 邮箱、手机号、Token、长数字 | 生产脱敏 |
| `rag-redaction-disabled-dev` | rag_answer | development + redactContent=false | 原文保留 |
| `rag-error-fallback` | rag_answer | timeout + fallback | 错误事件和降级状态 |
| `production-workflow-success` | production_workflow | 完成态多 Agent | stage span、tool event、generation |
| `production-workflow-approval-pending` | production_workflow | 审批等待 | pendingApprovalRoles、approval mode |
| `production-workflow-tool-error` | production_workflow | 工具失败 | error、fallback、failed 状态 |
| `scheduled-analysis-success` | scheduled_analysis | 周报分析 | trace、generation、snapshotCounts |
| `scheduled-analysis-redaction` | scheduled_analysis | 报告含 PII | 定时分析脱敏 |
| `smoke-enabled-contract` | smoke | 正常 key 配置 | smoke sent=true |
| `disabled-missing-keys` | disabled | enabled=true + 空 key | fail closed、无 batch |
| `disabled-explicit` | disabled | enabled=false | 稳定禁用契约 |

## 5. 执行方式

```bash
cd backend

# 生成数据集
pnpm run eval:langfuse:generate

# 检查数据集是否与生成器一致
pnpm run eval:langfuse:check

# 执行完整 Langfuse 可观测性回归
pnpm run eval:langfuse:dataset
```

执行后报告：

```text
.tmp/evidence/langfuse-observability-latest.json
```

报告包含：

- 每个场景的 batch 数量；
- 每个 trace/generation/span 的断言；
- 每个 expected contains/absent 断言；
- disabled 结果断言；
- 失败场景列表；
- 数据集方向和版本。

## 6. 当前实测结果

```json
{
  "passed": true,
  "scenarios": 19,
  "failedScenarioIds": [],
  "checks": 150,
  "failedChecks": 0,
  "directions": 14
}
```

## 7. 真实 Langfuse 云端验收

离线回归通过后，还需要在真实 Langfuse 环境确认以下内容：

```bash
cd backend
LANGFUSE_ENABLED=true \
LANGFUSE_PUBLIC_KEY=... \
LANGFUSE_SECRET_KEY=... \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
pnpm run smoke:langfuse
```

云端 Dashboard 需要人工或 API 检查：

- trace 是否出现；
- generation 的 input/output/model/usage/cost 是否正确；
- span 层级和工具事件是否可展开；
- userId/sessionId 是否能筛选；
- 脱敏后的文本是否不包含原始 PII；
- smoke trace 是否有对应 generation；
- flush 后 health 是否更新；
- 失败 tool 或 fallback 是否能在 trace 中定位。

## 8. 与真实私有数据的区别

当前数据集是 `synthetic: true` 的合成 fixture，只验证可观测性契约和字段完整性。

它不能证明：

- 真实业务问题回答正确率；
- 真实检索召回率；
- 真实用户会话数据分布；
- 真实 Langfuse 云端 trace 已经成功写入。

真实业务质量应使用 `independent-golden.dataset.json` 或替换为私有 golden set 后运行 live 评测。
