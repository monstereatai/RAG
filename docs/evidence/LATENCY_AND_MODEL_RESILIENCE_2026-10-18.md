# 延迟优化与模型依赖稳定性报告

- 日期：2026-10-18
- 环境：本地真实链路
- 依赖：NestJS、PostgreSQL/pgvector、Redis、Milvus、Elasticsearch、Qwen、DeepSeek fallback
- 数据集：`backend/eval/independent-golden.dataset.json`
- 数据性质：合成数据，`synthetic: true`

## 1. 结论

本轮完成两类改造：

1. 降低 simple 和 auto 的端到端延迟。
2. 为模型依赖增加请求超时、流式 fallback、调用 fallback、连续失败熔断和故障注入验证。

最终结果：

| 指标 | 优化前 | 优化后 | 变化 |
|---|---:|---:|---:|
| 完整 golden 回答数 | 48 | 48 | 不变 |
| 总通过率 | 100% | 100% | 不变 |
| 平均延迟 | 7,775 ms | 4,640 ms | 下降 40.3% |
| P95 延迟 | 15,443 ms | 10,495 ms | 下降 32.0% |
| simple 平均延迟 | 8,812 ms | 3,787 ms | 下降 57.0% |
| simple P95 | 14,557 ms | 8,734 ms | 下降 40.0% |
| auto 平均延迟 | 6,739 ms | 5,494 ms | 下降 18.5% |
| auto P95 | 15,443 ms | 13,429 ms | 下降 13.0% |
| query 级错误 | 0 | 0 | 保持 |

质量指标保持：

| 指标 | 优化后 |
|---|---:|
| 关键词准确率 | 100% |
| 引用通过率 | 100% |
| 拒答准确率 | 100% |
| 版本冲突准确率 | 100% |
| 检索 Hit@K | 100% |
| 检索 MRR | 0.9674 |
| 检索 nDCG | 100% |

## 2. 延迟优化内容

### 2.1 simple 短问题跳过规划模型调用

问题：

- 每次 simple 提问都会先调用一次 QueryPlanner LLM，再执行检索和答案生成。
- 对“生产系统权限有效期是多久”这类短事实问题，规划调用的收益很低，但增加数秒延迟。

改动：

- `QueryPlannerService` 增加本地 fast path。
- 仅对以下情况启用：
  - simple 模式；
  - 无历史上下文；
  - 问题长度不超过 120 字符；
  - 不含多疑问、逗号、分号、追问词、版本冲突、实时信息等复杂信号。
- 命中时使用保守的 `createFallbackQueryPlan`，跳过规划模型。

结果：

- Prometheus 显示 8 次 simple 基准请求全部命中 `fast_path`。
- simple P50 从约 8.8 秒降到约 1.6 秒到 4 秒区间，具体取决于检索和答案长度。

配置：

```env
QUERY_PLANNER_FAST_PATH_ENABLED=true
```

### 2.2 Agentic 自检调用 fast path

问题：

- Agentic 每次回答都会额外调用：
  - LLM 充分性判断；
  - LLM 答案反思。
- 但本地质量门禁、答案契约、引用覆盖已经可以给出确定结论。

改动：

- 当本地子问题证据全部通过时，跳过充分性模型调用。
- 当 `answer_contract.valid=true`、`citationSupported=true` 且 `subQuestionCoverage>=1` 时，跳过反思模型调用。
- 保留超时或本地门禁不充分时的 LLM 自检路径。

配置：

```env
AGENTIC_SUFFICIENCY_FAST_PATH_ENABLED=true
AGENTIC_REFLECTION_FAST_PATH_ENABLED=true
```

### 2.3 结构化证据直接回答

问题：

- 部分 Agentic 查询已经有了可验证的结构化事实，但仍然先走一轮长答案生成，再因为引用门禁回退到抽取式答案。
- 这条路径会浪费一次完整模型生成。

改动：

- 当 `buildEvidenceFirstAnswer` 生成的结构化答案能够通过引用校验时，直接返回该答案并跳过生成与反思。
- 返回的答案仍包含 citation 和 answer artifact。

### 2.4 修正 rerank 耗时指标

发现：

- 一条检索路径把 `process.hrtime.bigint()` 当作耗时直接写入 Prometheus。
- 导致 `rag_retrieval_duration_seconds` 的 rerank sum 出现十几万秒的荒谬值。

修复：

- 改为记录 `now - rerankStartedAt` 的秒数。
- 指标现在可以用于真实 P95/P99 分析。

## 3. 模型依赖稳定性改造

### 3.1 请求级 timeout

新增：

```env
LLM_REQUEST_TIMEOUT_MS=90000
```

行为：

- 由 `LlmProvider.getModel()` 返回的所有 `invoke`、`stream`、`transform`、`batch` Runnable 调用都会自动合并请求取消信号和 90 秒 timeout。
- 不再允许单次流式请求无限挂起。

### 3.2 invoke fallback

`LlmProvider.invoke()` 现在按策略执行：

1. primary provider；
2. 如果 primary 抛错且请求未被用户取消，则尝试配置的 fallback provider；
3. fallback 成功则返回结果；
4. primary 和 fallback 都失败才向上抛出受控错误。

相关配置：

```env
LLM_GATEWAY_FALLBACK_ENABLED=true
LLM_GATEWAY_FALLBACK_PROVIDER=deepseek
```

### 3.3 流式 fallback

主回答链路使用 `getModel().stream()`，不经过 `invoke()`，因此增加了流式 fallback：

- primary stream 在首 token 前失败时，自动切换 fallback provider 重放同一请求；
- 已经输出 token 后失败时不会拼接两套答案，而是向上抛出错误；
- 请求被用户取消时不会触发 fallback。

### 3.4 熔断器

新增：

```env
LLM_CIRCUIT_FAILURE_THRESHOLD=2
LLM_CIRCUIT_OPEN_MS=30000
```

行为：

- 某个 provider 连续失败达到阈值后进入 open 状态；
- open 窗口内的请求跳过该 provider；
- 窗口结束后允许一次 half-open 探测；
- 探测成功恢复，失败重新打开；
- 流式回答和普通 invoke 共用同一个 provider circuit 状态。

## 4. 故障注入验证

为了验证不是“代码里写了 fallback”，单独启动 3102 端口后端实例：

```bash
PORT=3102 \
MEM0_ENABLED=false \
QWEN_LLM_BASE_URL=http://127.0.0.1:1/v1 \
QWEN_TIMEOUT_MS=2000 \
QWEN_MAX_RETRIES=0 \
LLM_REQUEST_TIMEOUT_MS=8000 \
LLM_CIRCUIT_FAILURE_THRESHOLD=1 \
LLM_CIRCUIT_OPEN_MS=60000 \
LLM_GATEWAY_FALLBACK_PROVIDER=deepseek \
node dist/src/main.js
```

说明：

- `QWEN_LLM_BASE_URL` 指向不可达地址，模拟 Qwen 故障。
- Embedding 继续使用正常 Qwen 地址，避免把向量故障混入模型 fallback 验证。
- 关闭 Mem0，隔离外部记忆服务的干扰。

真实 HTTP 请求结果：

| 请求 | 结果 | 延迟 | 引用数 | 日志 |
|---|---|---:|---:|---|
| 第 1 次，Qwen 不可达 | HTTP 201 | 5,131 ms | 3 | `Primary stream failed, falling back to provider=deepseek` |
| 第 2 次，熔断窗口内 | HTTP 201 | 3,500 ms | 4 | `Primary provider circuit open; using fallback=deepseek` |

结论：

- Qwen 主模型连接失败时，流式回答成功切换到 DeepSeek。
- 熔断器打开后，第二个请求直接走 DeepSeek，不再重复消耗 Qwen 超时。
- 接口没有返回 500。
- 答案仍带 citations。

## 5. 性能基准复测

命令：

```bash
cd backend

PERF_RAG_BASE_URL=http://localhost:3000 \
PERF_RAG_SAMPLES=8 \
PERF_RAG_CONCURRENCY=1 \
PERF_RAG_PROFILE=local \
PERF_RAG_ENFORCE=false \
pnpm run perf:rag
```

最新 8 样本串行结果：

| 模式 | 成功 | 错误率 | P50 | P95 | 最大延迟 | 吞吐 |
|---|---:|---:|---:|---:|---:|---:|
| simple | 8/8 | 0% | 1,639 ms | 3,195 ms | 3,195 ms | 0.547 req/s |
| agentic（qwen-turbo 快速验证） | 2/2 | 0% | 13,712 ms | 14,048 ms | 14,048 ms | 并发见下节 |

### 5.1 Agentic generation model comparison

同一 benchmark 查询、单并发：

| Agentic generation model | P50 | P95 | 结论 |
|---|---:|---:|---|
| qwen-plus | 27,526 ms | 32,022 ms | 质量优先，交互延迟高 |
| deepseek-v4-flash | 33,438 ms | 37,088 ms | 本环境不作为更快路径 |
| qwen-turbo | 11,387 ms | 19,443 ms | 当前交互式 Agentic 默认 |

因此新增配置：

```env
QWEN_AGENTIC_MODEL=qwen-turbo
```

- `simple` / `auto` 仍使用原来的 `QWEN_MODEL`。
- Agentic 生成节点使用 `QWEN_AGENTIC_MODEL`。
- 需要更高质量的长任务时可显式改回 `qwen-plus`。

### 5.2 并发压测

完整 2/5/10 并发矩阵见：

`docs/evidence/CONCURRENCY_LOAD_TEST_2026-10-18.md`

摘要：

| 模式 | 并发 | P50 | P95 | 错误率 | 吞吐 |
|---|---:|---:|---:|---:|---:|
| simple | 10 | 3,285 ms | 4,804 ms | 0% | 2.081 req/s |
| auto（复杂问题路由到 Agentic） | 10 | 18,268 ms | 19,605 ms | 0% | 0.510 req/s |
| agentic | 10 | 10,187 ms | 12,366 ms | 0% | 0.809 req/s |

### 5.3 当前瓶颈

使用 `qwen-turbo` 后，Agentic P50 已降到约 10～14 秒，但仍然是长任务：

- `simple`：并发 10 时 P50 3.3 秒，P95 4.8 秒；
- `agentic`：并发 10 时 P50 10.2 秒，P95 12.4 秒；
- 复杂 `auto` 查询会被路由到 Agentic，并发 10 时 P50 约 18.3 秒；
- 主要耗时仍是 Agentic 答案生成和引用校验/回退链路。

因此：

- 普通交互问答优先走 `simple`；复杂问题走 `auto`。
- 显式 `agentic` 适合长任务、多步分析和可接受 10～20 秒等待的场景。
- 当前 Agentic 仍不宜承诺严格的实时聊天 SLA。

## 6. 代码和配置变更

主要代码：

- `backend/src/rag/planning/query-planner.service.ts`
- `backend/src/modules/chat/chat.service.ts`
- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/providers/llm/llm.provider.ts`
- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/src/config/configuration.ts`

主要配置：

```env
LLM_REQUEST_TIMEOUT_MS=90000
LLM_CIRCUIT_FAILURE_THRESHOLD=2
LLM_CIRCUIT_OPEN_MS=30000
QUERY_PLANNER_FAST_PATH_ENABLED=true
AGENTIC_SUFFICIENCY_FAST_PATH_ENABLED=true
AGENTIC_REFLECTION_FAST_PATH_ENABLED=true
QWEN_AGENTIC_MODEL=qwen-turbo
```

## 7. 边界

本轮仍不能证明：

- 真实私有知识库上的准确率；
- 多实例部署下的熔断状态共享；
- 50 QPS 等并发场景下的 P95；
- Qwen 和 DeepSeek 答案质量完全一致；
- 两个 provider 同时故障时的最终 SLA。

下一阶段建议：

1. 用真实私有 golden set 重跑 simple/auto。
2. 在 50 QPS、多实例和共享 Redis/Milvus/ES 环境下复测。
3. 对 Qwen 和 DeepSeek 同时不可用的场景做联合故障演练。
4. 将 fallback 触发次数、熔断状态、fallback 延迟接入 Prometheus 和告警。
5. 对 Agentic 输出规模、首 token 延迟和引用门禁回退率继续做专项优化。
