# RAG 并发压测报告

- 日期：2026-10-18
- 服务：`http://localhost:3000/api/v1`
- 模式：simple、auto、agentic
- 并发：2、5、10
- 每种组合：10 个真实请求
- 单实例本地环境
- 数据性质：工程压测，不代表生产集群容量

## 1. 执行命令

```bash
cd backend

PERF_RAG_BASE_URL=http://localhost:3000 \
PERF_RAG_MODES=simple \
PERF_RAG_SAMPLES=10 \
PERF_RAG_CONCURRENCY=2 \
PERF_RAG_PROFILE=local \
PERF_RAG_ENFORCE=false \
PERF_RAG_REQUEST_TIMEOUT_MS=120000 \
PERF_RAG_OUTPUT=.tmp/evidence/load-simple-c2.json \
node scripts/benchmark-rag.mjs
```

其余组合使用相同方式：

- `PERF_RAG_MODES=simple|auto|agentic`
- `PERF_RAG_CONCURRENCY=2|5|10`

Agentic 使用：

```env
QWEN_AGENTIC_MODEL=qwen-turbo
```

## 2. 总结果

所有 9 个组合均为 10/10 成功，错误率 0%。

| 模式 | 并发 | 成功 | P50 | P95 | 最大延迟 | 吞吐 | 总耗时 |
|---|---:|---:|---:|---:|---:|---:|---:|
| simple | 2 | 10/10 | 1,683 ms | 2,255 ms | 2,255 ms | 1.107 req/s | 9,031 ms |
| simple | 5 | 10/10 | 2,638 ms | 2,960 ms | 2,960 ms | 1.814 req/s | 5,513 ms |
| simple | 10 | 10/10 | 3,285 ms | 4,804 ms | 4,804 ms | 2.081 req/s | 4,805 ms |
| auto | 2 | 10/10 | 16,777 ms | 18,498 ms | 18,498 ms | 0.114 req/s | 87,346 ms |
| auto | 5 | 10/10 | 16,136 ms | 19,545 ms | 19,545 ms | 0.260 req/s | 38,430 ms |
| auto | 10 | 10/10 | 18,268 ms | 19,605 ms | 19,605 ms | 0.510 req/s | 19,607 ms |
| agentic | 2 | 10/10 | 10,918 ms | 15,565 ms | 15,565 ms | 0.159 req/s | 62,883 ms |
| agentic | 5 | 10/10 | 11,807 ms | 15,506 ms | 15,506 ms | 0.389 req/s | 25,693 ms |
| agentic | 10 | 10/10 | 10,187 ms | 12,366 ms | 12,366 ms | 0.809 req/s | 12,368 ms |

## 3. 分模式分析

### 3.1 simple

结果：

- 并发 2：P50 1.68 秒，P95 2.26 秒
- 并发 5：P50 2.64 秒，P95 2.96 秒
- 并发 10：P50 3.28 秒，P95 4.80 秒
- 错误率始终为 0%

判断：

- simple 在单实例并发 10 下仍可用。
- 延迟随并发上升，但没有出现雪崩或错误。
- 单实例本地吞吐约 2.08 req/s。
- 这个数字不能直接换算为生产集群 QPS，因为单实例还包含 LLM 网络、Mem0、Langfuse、检索和数据库共享开销。

### 3.2 auto

本压测使用复杂问题：

```text
RAG 性能基准：RAG 系统有哪些关键组件？
```

该问题被 auto 路由到 Agentic，因此 auto 的组合延迟接近 Agentic。

结果：

- P50 约 16～18 秒
- P95 约 18.5～19.6 秒
- 错误率 0%
- 并发 10 吞吐约 0.51 req/s

判断：

- auto 的简单问题会走 Fast Path，但复杂问题会承担 Agentic 延迟。
- 产品 UI 应区分“快速回答”和“深度分析”，不要让所有 auto 请求都承诺秒级返回。
- 对于需要交互体验的场景，建议先走 simple，再提供“继续深挖”按钮触发 agentic。

### 3.3 agentic

结果：

- 并发 2：P50 10.92 秒，P95 15.57 秒
- 并发 5：P50 11.81 秒，P95 15.51 秒
- 并发 10：P50 10.19 秒，P95 12.37 秒
- 错误率 0%
- 并发 10 吞吐约 0.81 req/s

判断：

- qwen-turbo 使 Agentic P50 从约 27.5 秒降到约 10～12 秒。
- 当前并发 10 没有出现错误，但样本量只有 10 个请求每格。
- Agentic 仍然是长任务，不适合严格的首屏秒级 SLA。
- 对批量分析任务，建议使用队列异步执行，而不是同步占满 HTTP 连接。

## 4. 稳定性观察

压测期间：

- 没有 500。
- 没有 query 级 timeout。
- fallback / circuit breaker 没有误触发正常请求。
- 所有组合 errorRate 为 0%。
- 服务在压测后仍可正常响应 health check。

## 5. 当前容量判断

本地单实例、并发 10 的粗略能力：

| 模式 | 可承受并发 | P95 | 吞吐 | 判断 |
|---|---:|---:|---:|---|
| simple | 10 | 4.8 秒 | 2.08 req/s | 可用，适合交互 |
| auto（复杂问题） | 10 | 19.6 秒 | 0.51 req/s | 适合异步或明确深度分析 |
| agentic | 10 | 12.4 秒 | 0.81 req/s | 适合队列化长任务 |

注意：

- 这是单实例、本地依赖和单模型 endpoint 的结果。
- 10 个请求不是生产容量结论。
- 生产需要多实例、共享 Redis/Milvus/ES、Langfuse 异步刷新、模型限流和队列削峰。
- 50 QPS 尚未压测。

## 6. 结论

本轮并发压测通过：

- 9 个模式×并发组合；
- 90 个真实请求；
- 0 错误；
- simple 在并发 10 下仍保持可交互延迟；
- Agentic 在 qwen-turbo 下进入 10～15 秒区间；
- 复杂 auto 仍会继承 Agentic 的长延迟。

下一步应做：

1. 50 QPS 和多实例压测；
2. Agentic 异步队列化；
3. 真实私有数据下的 simple/auto 质量回归；
4. 将 fallback、circuit、agentic duration 和队列长度接入告警；
5. 对 Qwen 与 fallback 同时不可用做联合故障演练。
