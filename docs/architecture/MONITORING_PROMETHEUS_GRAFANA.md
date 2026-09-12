# Prometheus + Grafana 监控体系落地说明

面向本仓库两个服务（RAG 后端 `backend/`、管理后台 `admin-backend/`）的完整监控方案：指标埋点、抓取配置、告警规则、Grafana 看板，以及分桶与窗口的设计依据。

## 1. 文件清单

| 路径 | 作用 |
| --- | --- |
| `backend/src/modules/metrics/metrics.service.ts` | RAG 后端全部指标定义与埋点方法（prom-client） |
| `admin-backend/src/modules/metrics/metrics.service.ts` | 管理后台指标（手写 Prometheus 文本格式，含 histogram 分桶） |
| `monitoring/prometheus/prometheus.yml` | 抓取配置（含 `metrics_path` 与过渡期代理任务） |
| `monitoring/prometheus/rules.yml` | 23 条告警规则（3 组：`rag-slo` 16、`admin-service` 3、`prometheus-self` 4） |
| `monitoring/prometheus/recording-rules.yml` | 17 条记录规则，预计算 P50/P95/P99、QPS、错误率、命中率 |
| `monitoring/prometheus/alertmanager.yml` | 告警通知：分级路由、分组、4 条抑制规则、钉钉/企微/邮件出口 |
| `monitoring/docker-compose.monitoring.yml` | Prometheus + Alertmanager + Grafana 一键启动，含 Linux `extra_hosts` |
| `monitoring/grafana/dashboards/rag-overview.json` | 可导入看板（uid `rag-overview`，57 个数据面板） |
| `monitoring/grafana/PANELS.md` | 面板清单：标题 / 图表类型 / 完整 PromQL / 窗口选择理由 |
| `monitoring/grafana/provisioning/**` | Grafana 数据源与看板自动装载 |
| `backend/scripts/metrics-unwrap-proxy.mjs` | 临时桥：剥掉 `{code,data,message}` 包裹，供后端重启前使用 |

## 2. 指标契约

### 2.1 命名规范

- counter 一律 `_total` 结尾；histogram 由客户端库展开 `_bucket` / `_sum` / `_count`
- 时间单位一律 `_seconds`（不使用毫秒），长度单位用 `_bytes`
- 服务前缀区分来源：RAG 后端 `rag_`、管理后台 `admin_`，避免同一 Prometheus 内重名
- label 只保留低基数维度

### 2.2 RAG 后端

| 指标 | 类型 | label | 说明 |
| --- | --- | --- | --- |
| `rag_http_requests_total` | counter | `method` `route` `status` | RED 的 Rate |
| `rag_http_request_duration_seconds` | histogram | `method` `route` `status` | RED 的 Duration（P50/P95/P99） |
| `rag_retrieval_hits_total` | counter | `source` `mode` | 各通道累计召回条数 |
| `rag_retrieval_recalled_chunks` | histogram | `stage` `source` | 单次召回条数分布（补齐项） |
| `rag_retrieval_duration_seconds` | histogram | `stage` `status` | 向量检索 / BM25 / Rerank 分阶段耗时（补齐项） |
| `rag_retrieval_context_chunks` | histogram | `intent` | 最终上下文 chunk 数 |
| `rag_retrieval_context_characters` | histogram | `intent` | 最终上下文长度 |
| `rag_retrieval_expanded_chunks_total` | counter | `intent` | 邻居/同章节扩展量 |
| `rag_llm_calls_total` | counter | `provider` `model` `status` | LLM 调用次数，`status` ∈ `success`/`fallback`/`error` |
| `rag_llm_call_duration_seconds` | histogram | `provider` `model` `status` | LLM 单次耗时 |
| `rag_llm_tokens_estimated_total` | counter | `provider` `model` `type` | token 消耗，`type` ∈ `prompt`/`completion` |
| `rag_cache_requests_total` | counter | `cache` `result` | 缓存命中，`result` ∈ `hit`/`miss`（补齐项） |
| `rag_cache_operation_duration_seconds` | histogram | `cache` `operation` | 缓存读写耗时（补齐项） |
| `rag_agent_node_duration_seconds` | histogram | `node` `status` | LangGraph 节点耗时 |
| `rag_agent_first_token_duration_seconds` | histogram | `route` | 首 token 延迟（TTFT） |
| `rag_agent_tool_calls_total` | counter | `tool` `status` | 工具调用次数与成败 |
| `rag_agent_loop_terminations_total` | counter | `reason` | Agent 循环终止原因 |
| `rag_agent_empty_retrieval_total` | counter | `route` | 空召回次数 |
| `rag_scheduled_job_runs_total` | counter | `task_kind` `status` | 定时任务运行结果 |
| `rag_scheduled_job_duration_seconds` | histogram | `task_kind` `status` | 定时任务耗时 |
| `rag_dangerous_queries_blocked_total` | counter | `pattern` `route` | 危险查询拦截 |
| `rag_process_*` / `rag_nodejs_*` | 默认指标 | — | 进程与运行时（`collectDefaultMetrics({ prefix: 'rag_' })`） |

### 2.3 管理后台

| 指标 | 类型 | label | 说明 |
| --- | --- | --- | --- |
| `admin_http_requests_total` | counter | `method` `route` `status` | RED 的 Rate |
| `admin_http_request_duration_seconds` | histogram | `method` `route` `status` | RED 的 Duration，含 `le` 分桶（补齐项） |
| `admin_http_requests_errors_total` | counter | `method` `route` `status` | 5xx 单独导出，告警可直接引用 |
| `admin_process_start_time_seconds` | gauge | — | 进程启动时间，用于识别重启 |
| `node_memory_usage_bytes` / `node_cpu_usage_seconds_total` / `node_uptime_seconds` | gauge/counter | `type` | 运行时指标 |

> 补齐说明：管理后台原先只导出 `_sum` / `_count`（无 `_bucket`），**无法计算任意分位**；现已补上 13 档 `le` 分桶。

## 3. 埋点实现要点

### 3.1 LLM 指标加 `model` label

三个 provider（`deepseek-llm.provider.ts` / `qwen-llm.provider.ts` / `zhipu-llm.provider.ts`）在构造时缓存配置中的模型名，调用时一并上报：

```ts
this.metricsService.observeLlmCall(
  'deepseek',        // provider
  this.modelName,    // model（来自 llm.deepseek.model 配置）
  status,            // success | error
  durationSeconds,
  inputTokensEstimated,
  this.estimateTokens(answer),
);
```

`observeLlmCall` 内部同时更新 `rag_llm_calls_total`、`rag_llm_call_duration_seconds`，并按 `type="prompt"` / `type="completion"` 分别累加 token。

### 3.2 检索分阶段埋点

在 `karpathy-rag.service.ts` 的主检索链路与 `retrieveBm25Only` 两条路径上：

- `stage="bm25"`：本地 BM25 + ES 全文检索合并，失败时以 `status="error"` 记录后原样抛出（不改变原有异常语义）
- `stage="vector_search"`：`embedQuery` + Milvus `similaritySearch`（含 ES kNN 合并），Milvus 失败并降级 BM25 时记 `status="error"`
- `stage="rerank"`：仅当 `applyRerank` 真正调用远端（`applied === true`）时记录，避免未启用时的 0ms 样本污染分位

每阶段同时调用 `observeRetrievalRecalled(stage, source, count)` 记录召回条数分布。

### 3.3 缓存命中埋点

| `cache` label | 位置 | 语义 |
| --- | --- | --- |
| `short_term_summary` | `modules/memory/short-term-memory.service.ts` | 会话摘要缓存，命中即复用 Redis 中的摘要 |
| `tool_idempotency` | `tools/tool-execution.service.ts` | 工具幂等结果缓存，命中即跳过重复写入 |

两者均通过 `@Optional()` 注入 `MetricsService`，未引入 MetricsModule 时静默降级，不阻断主流程。

## 4. 抓取配置

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/rules.yml

scrape_configs:
  - job_name: 'rag-backend'
    metrics_path: '/api/v1/metrics'      # 关键：默认 /metrics 会 404
    static_configs:
      - targets: ['host.docker.internal:3000']

  - job_name: 'admin-backend'
    metrics_path: '/api/metrics'
    static_configs:
      - targets: ['host.docker.internal:3001']
```

两个服务都必须显式写 `metrics_path`：

- RAG 后端全局前缀是 `api` 且启用了 URI 版本号，真实路径是 `/api/v1/metrics`
- 管理后台全局前缀是 `api`，真实路径是 `/api/metrics`

### Linux 下的 `host.docker.internal`

`host.docker.internal` 是 Docker Desktop（macOS / Windows）的内置域名，**Linux 原生 Docker 不存在**，容器里会直接解析失败。两种办法：

1. 推荐：给容器加 `extra_hosts`，把域名指向宿主机网关（本仓库的 compose 已写死）

```yaml
services:
  prometheus:
    extra_hosts:
      - 'host.docker.internal:host-gateway'
```

`host-gateway` 是 Docker 20.10+ 支持的魔法值，自动解析为宿主机网关地址，换机器、切网络都不用改配置。

2. 备选：`--network host`（会失去端口映射语义）或直接写宿主机内网 IP（换网络后 IP 会变，不宜入库）。

改动后热加载：`curl -X POST http://localhost:9090/-/reload`（需 `--web.enable-lifecycle`）。

### 一个服务只能有一个 scrape job（重要）

看板与告警里的 PromQL **绝大多数不带 `job` 过滤**（保持表达式简洁、看板可复制）。因此如果同一个进程被两个 job 同时抓取，`sum(rate(...))` 会把 QPS、错误率分母、token 速率、缓存命中率**整体翻倍**，而 P99 会因为样本混合而失真——这类错误在平时看不出来，只有在扩容或临时加通道时突然出现。

所以：

- 正式配置里 RAG 后端只有 `rag-backend` 一个 job、管理后台只有 `admin-backend` 一个 job
- 过渡期的去包裹代理 job 在配置文件末尾以注释形式提供，**启用时必须同时注释掉直连 job**

## 5. 告警规则

`monitoring/prometheus/rules.yml` 共 19 条，已通过 `promtool check rules`（`SUCCESS: 19 rules found`）。

| 分组 | 告警 | 阈值 | `for` | 为什么是这个持续时间 |
| --- | --- | --- | --- | --- |
| rag-slo | `RagServiceDown` | `up{job="rag-backend"} == 0` | 1m | ≈4 个抓取周期，可过滤容器重启/发布抖动 |
| rag-slo | `RagMetricsEndpointBroken` | 抓取成功但无 `rag_http_requests_total` | 5m | 监控自身失效需要更稳的确认窗口 |
| rag-slo | `RagHttpErrorRateHigh` | 5xx 占比 > 5% | 5m | 比例型指标需足够样本；与看板口径一致 |
| rag-slo | `RagHttpErrorRateElevated` | 4xx 占比 > 20% | 10m | 客户端错误多为瞬时，拉长窗口降噪 |
| rag-slo | `RagHttpP99LatencyHigh` | 5m P99 > 5s（按 route） | 10m | 区分持续劣化与偶发长文生成 |
| rag-slo | `RagLlmP99LatencyHigh` | 5m P99 > 20s（按 provider/model） | 10m | 生成类接口天然慢，单独设阈 |
| rag-slo | `RagVectorSearchP99LatencyHigh` | 5m P99 > 1s | 10m | 向量检索亚秒级，1s 已是明显异常 |
| rag-slo | `RagLlmFailureRateHigh` | error 占比 > 10% | 5m | 供应商偶发 429/超时常见，需持续失败才介入 |
| rag-slo | `RagLlmFallbackRateHigh` | fallback 占比 > 30% | 10m | 质量风险类，窗口长一些 |
| rag-slo | `RagVectorSearchFailing` | 任一时刻存在 error > 0 | 5m | 检索报错会直接让答案退化 |
| rag-slo | `RagEmptyRetrievalRateHigh` | 空召回率 > 20% | 30m | 召回质量慢变量，短窗易被个别问题带偏 |
| rag-slo | `RagCacheHitRateLow` | 命中率 < 20% | 30m | 命中率波动大，短窗噪声高 |
| rag-slo | `RagScheduledJobFailing` | 15m 内 failed > 0 | 15m | 与任务调度周期匹配 |
| rag-slo | `RagEventLoopLagHigh` | P99 阻塞 > 0.5s | 15m | 累积型问题，瞬时尖刺无意义 |
| rag-slo | `RagMemoryUsageHigh` | RSS > 2GB | 30m | 排除批量入库导致的瞬时冲高 |
| rag-slo | `RagDangerousQueryBurst` | 10m 内拦截 > 20 | 10m | 兼顾攻击尝试与新规则误伤 |
| admin-service | `AdminServiceDown` | `up == 0` | 1m | 同 RAG 侧 |
| admin-service | `AdminHttpErrorRateHigh` | 5xx > 5% | 5m | 同口径便于双服务对比 |
| admin-service | `AdminHttpP99LatencyHigh` | P99 > 1s | 10m | 后台是交互型接口，1s 已明显卡顿 |

每条规则的 `annotations.description` 都写了排查方向（下钻的 PromQL、常见原因），可与看板配合使用。

另有 `prometheus-self` 组 4 条，监控监控系统自身（这是"没数据"和"没问题"必须能区分开的前提）：

| 告警 | 表达式 | `for` | 说明 |
| --- | --- | --- | --- |
| `PrometheusScrapeSlow` | `scrape_duration_seconds{job!="prometheus"} > 10` | 15m | 抓取超过 2/3 周期会让样本出现空洞，通常是指标输出过大 |
| `PrometheusRuleEvaluationFailing` | `rate(prometheus_rule_evaluation_failures_total[5m]) > 0` | 5m | 规则评估失败 = 告警静默失效，属最高优先级 |
| `PrometheusTooManySeries` | `prometheus_tsdb_head_series > 100000` | 15m | 高基数 label 失控的最直接信号（呼应第 9 节） |
| `AlertmanagerDown` | `up{job="alertmanager"} == 0` | 5m | 告警发不出去等于没有告警 |

### 5.2 通知链路（Alertmanager）

只有 `rules.yml` 时，告警只会停在 Prometheus 的 `/alerts` 页面，**没有人会收到消息**。`monitoring/prometheus/alertmanager.yml` 补齐这一段：

- **分级路由**：`severity=critical` 走 `critical` 接收器（`repeat_interval: 1h`），`warning` 走 `default`（`12h`），避免预警刷屏
- **分组**：`group_by: [alertname, service]`，`group_wait: 30s`（等同批规则算完再发）、`group_interval: 5m`（持续故障期间补进展）
- **抑制规则 4 条**：服务整体宕机时抑制该服务所有衍生告警；指标接口本身坏掉时抑制该服务业务告警（防止"监控失效 → 指标归零 → 一堆假告警"）；Prometheus 自身异常时抑制全部业务告警；critical 抑制同名的 warning
- **出口**：webhook 指向钉钉/企微 sidecar（如 `prometheus-webhook-dingtalk`，默认 8060），并保留注释掉的 `email_configs` 作为值班兜底。webhook 地址建议用环境变量注入，不要提交真实地址

sidecar 未启动时，Alertmanager 会把这些发送失败记为 notify errors，不影响规则评估，UI 上可见（`http://localhost:9093`）。

### 5.3 预计算（Recording rules）

`monitoring/prometheus/recording-rules.yml` 有 17 条记录规则，把看板和告警反复使用的聚合结果预先算好：

| 记录指标 | 用途 |
| --- | --- |
| `job:rag_http_request_duration_seconds:p50/p95/p99_5m` | 延迟分位，看板与告警共用同一口径 |
| `job:rag_http_requests:rate5m` / `_errors:rate5m` / `:error_ratio5m` | QPS、5xx 速率、错误率 |
| `job:rag_llm_calls:rate5m` / `:error_ratio5m` / `rag_llm_call_duration_seconds:p99_5m` / `rag_llm_tokens:rate1h` | LLM 次数、失败率、耗时、token 成本 |
| `job:rag_retrieval_duration_seconds:p99_5m` / `rag_retrieval_recalled_chunks:p95_5m` | 检索阶段耗时与召回量 |
| `job:rag_cache_requests:hit_ratio30m` | 缓存命中率 |
| `job:rag_agent_first_token_duration_seconds:p95_5m` | 首 token 延迟 |
| `job:admin_http_requests:rate5m` / `:error_ratio5m` / `admin_http_request_duration_seconds:p99_5m` | 管理后台 RED |

命名遵循 `level:metric:operations` 约定；记录出来的指标名**不带** `_bucket` / `_total` 后缀，因为它已经是计算结果而不是原始计数器。

## 6. Grafana 看板

看板文件 `monitoring/grafana/dashboards/rag-overview.json`，启动后地址 `http://localhost:3030`（避开后端 dev 的 3000 端口），默认账号 `admin` / `admin`。

分组与面板数：服务总览(7) / RED 指标(9) / 检索链路(8) / LLM 调用(8) / 缓存(4) / Agent 与任务(10) / 资源与运行时(11)。

完整面板清单（标题 + 图表类型 + PromQL + 窗口理由）见 `monitoring/grafana/PANELS.md`。几个核心面板：

| 面板 | 图表 | PromQL |
| --- | --- | --- |
| P99 延迟 | timeseries | `histogram_quantile(0.99, sum by (le) (rate(rag_http_request_duration_seconds_bucket[5m])))` |
| 5xx 错误率 | timeseries | `sum(rate(rag_http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(rag_http_requests_total[5m])), 0.0001)` |
| LLM P99 by model | timeseries | `histogram_quantile(0.99, sum by (le, provider, model) (rate(rag_llm_call_duration_seconds_bucket[5m])))` |
| 检索耗时 P99 by stage | timeseries | `histogram_quantile(0.99, sum by (le, stage) (rate(rag_retrieval_duration_seconds_bucket[5m])))` |
| 缓存命中率 | timeseries | `sum(rate(rag_cache_requests_total{result="hit"}[30m])) / clamp_min(sum(rate(rag_cache_requests_total[30m])), 0.0001)` |
| token 速率 by type | timeseries | `sum by (type) (rate(rag_llm_tokens_estimated_total[1h])) * 60` |

## 7. `rate()` 窗口怎么选

| 窗口 | 适用场景 | 依据 |
| --- | --- | --- |
| `1m` | 热力图、分布迁移观察 | 追求时间分辨率；15s 抓取 ≈ 4 个样本，仅够看形态不适合告警 |
| `5m` | 告警与实时排查（默认口径） | ≈20 个样本，尾部桶有足够计数量，分位稳定；同时不会把故障延迟太久 |
| `30m` | 命中率、召回质量 | 慢变量，短窗噪声大；避免正常内容更新造成误报 |
| `1h` | 趋势、成本核算、明细表 | 低频事件（如失败、降级）需累计样本才可读；`increase` 会自动补偿计数器重置 |
| 不带 rate | `up`、gauge、比值瞬时值 | 计数器才需要 rate；对 gauge 套 rate 会得到无意义斜率 |

配套原则：**同一张图里做比值的两个指标必须用同一窗口**，否则分子分母时间基准不一致，会出现莫名其妙的尖峰。

## 8. histogram 分桶设置

### 8.1 本项目各指标的桶

| 指标 | 分桶（秒） | 依据 |
| --- | --- | --- |
| `rag_http_request_duration_seconds` | 0.05 … 1 / 1.5 / 2 / 3 / 5 / 8 / 10 / 15 / 30 / 60 / 120 | RAG 的 SSE 问答与 Agent 多轮会跑到几十秒，必须覆盖到 120s |
| `rag_llm_call_duration_seconds` | 0.1 … 5 / 8 / 10 / 15 / 20 / 30 / 45 / 60 | 生成类长尾明显，60s 上限 |
| `rag_retrieval_duration_seconds` | 0.005 / 0.01 / 0.025 / 0.05 / 0.1 / 0.2 / 0.3 / 0.5 / 0.8 / 1.5 / 3 / 5 / 10 | 向量检索亚秒级，低区加密 |
| `rag_retrieval_recalled_chunks` | 1 / 2 / 3 / 5 / 8 / 12 / 20 / 30 / 50 | 条数是离散小整数，按业务候选深度分布设桶 |
| `rag_cache_operation_duration_seconds` | 0.0005 … 0.05 / 0.1 / 0.25 / 0.5 / 1 | Redis 操作通常在亚毫秒到毫秒级 |
| `admin_http_request_duration_seconds` | 0.005 … 1 / 2 / 3 / 5 / 10 / 30 | 后台交互型接口，无长流式请求 |
| `rag_scheduled_job_duration_seconds` | 0.1 … 10 / 30 / 60 / 120 | 批处理任务，量级到分钟 |

### 8.2 不同量级服务怎么调

| 服务类型 | 典型 P99 | 建议桶 |
| --- | --- | --- |
| 轻量 CRUD / 网关 | 10–200ms | 0.005 0.01 0.025 0.05 0.1 0.25 0.5 1 |
| 常规 API + 数据库查询 | 0.2–2s | 0.05 0.1 0.25 0.5 1 2 3 5 |
| 含 LLM / 长流式请求 | 5–60s | 0.5 1 2 5 10 20 30 60 120 |
| 批处理 / 离线任务 | 分钟级 | 1 5 15 30 60 300 600 |

经验做法：**先用观测值定桶**——上线初期把最大桶设得比预期 P99 大 2~4 倍，跑一周后按真实分布重新分配（在 P95~P99 区间加密，低区可适当放粗）。桶的数量控制在 10~15 个，收益递减且会增加序列数。

### 8.3 分桶不合理会让 P99 严重失真

`histogram_quantile` 是在桶内做线性插值，**桶的边界就是精度的上限**，两种典型失真：

1. **最大桶太小（最常见）**：桶最大只到 30s，而真实请求有 60s 和 120s 的。所有慢请求都被归入 `le="+Inf"`，`histogram_quantile` 会把它们插值到最后一个非 Inf 桶附近，于是**P99 被低估到 30s 以下**——线上已经卡成 60s，看板却显示「一切正常」。本仓库此前的 `rag_http_request_duration_seconds` 正是 30s 封顶，已扩到 120s。
2. **桶太稀或位置不对**：只有 `[0.1, 1, 10]` 三档时，真实值 0.4s 与 0.9s 会落在同一个桶里，P99 只能返回插值近似，误差可能超过 2 倍。

两个自检手段：

- 看 `_bucket{le="+Inf"}` 与最大非 Inf 桶的差值占比，如果超过 1%，说明最大桶不够，需要继续加大
- 用 `histogram_quantile` 的结果与日志里的真实耗时分位数抽样比对，偏差持续 >20% 就该调桶

注意：**桶一旦上线就改不动历史数据**，扩容桶需要重新累积（所以上线前宁可多留量级）。

## 9. 禁止把高基数维度放进 label

`user_id`、`request_id`、`trace_id`、`session_id`、`docId`、`query` 原文等**一律不进 label**，原因：

1. **时间序列数量爆炸**：序列数 ≈ 各 label 取值的笛卡尔积。以 `request_id` 为例，每次请求都会新建一条序列，一天数十万请求就是数十万条序列，一周后 Prometheus 内存与磁盘会被迅速吃满，甚至触发 OOM。
2. **抓取与查询变慢**：`/metrics` 输出体积随序列数线性增长，抓取超时；带高基数 label 的 PromQL（`sum by (user_id)`）要扫描海量序列，查询从毫秒级退化到秒级甚至超时。
3. **远程写成本**：若接远端存储（Thanos / VictoriaMetrics / 云托管），按样本数或序列数计费，高基数 label 会直接推高账单。
4. **聚合意义很小**：指标的作用是统计与告警，逐用户、逐请求的明细本来就是日志与 trace 的职责。

正确落点：

| 需求 | 该放哪里 |
| --- | --- |
| 定位某次慢请求 / 某用户的完整链路 | 日志（含 trace_id）+ 分布式追踪（LangFuse / OTLP） |
| 单条慢请求与直方图关联 | histogram 的 **exemplar**（把 trace_id 挂到样本上） |
| 按租户/用户维度做业务分析 | 数据库或数仓（明细表），不要用指标 |
| 确实需要少量高价值维度 | 收敛成有限枚举后再做 label（如 `plan_type="free|pro|enterprise"`） |

本仓库的 label 全部是有限枚举或路由模板（`route="/api/v1/rag/admin/documents/:id"` 这类已归一化的模板，而非真实 URL），不包含任何用户输入。

## 10. 验证记录

在交付时已实测：

```bash
# 规则与配置校验（promtool 必须挂到 /etc/prometheus/ 下，否则 rule_files 相对路径校验失败）
docker run --rm --entrypoint /bin/promtool \
  -v "$PWD/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  -v "$PWD/prometheus/rules.yml:/etc/prometheus/rules.yml:ro" \
  -v "$PWD/prometheus/recording-rules.yml:/etc/prometheus/recording-rules.yml:ro" \
  prom/prometheus:v2.53.0 check config /etc/prometheus/prometheus.yml
# => SUCCESS: 2 rule files found / SUCCESS: 23 rules found / SUCCESS: 17 rules found

# Alertmanager 配置校验
docker run --rm --entrypoint /bin/amtool \
  -v "$PWD/prometheus/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
  prom/alertmanager:v0.27.0 check-config /etc/alertmanager/alertmanager.yml
# => SUCCESS / route / 4 inhibit rules / 2 receivers

# 运行时状态
#   规则：23 条告警 + 17 条记录规则，health 全部 ok，0 评估异常
#   抓取：prometheus / alertmanager / rag-backend(代理通道) 全部 up
#   记录规则已产出序列：P50/P95/P99 与 rate5m
#   Grafana 数据源代理查询 P99 实测返回 49.5ms
```

### 过渡期运行状态说明

本轮验证时后端进程尚未重启，因此**运行中的 Prometheus 使用了一份临时配置**（`/tmp/prometheus-transition.yml`，不入仓库）：它与仓库配置的唯一区别是 RAG 只保留 `rag-backend`（9101 去包裹代理）一个 job，直连 3000 的 job 被移除。这样既保证看板有数据，又不会因为两个 job 抓同一进程导致指标翻倍。

该临时配置下有两个后果，重启后端后即消失：

- 管理后台（3001）暂时不在抓取列表中，`AdminServiceDown` 等 admin 规则暂不评估
- 后端重启后应切回 `monitoring/prometheus/prometheus.yml`，并停掉 9101 代理与 `metrics-unwrap-proxy.mjs`

切临时配置时有个坑值得记下来：**不要用 `docker run` 手工起 Prometheus 替换 compose 的容器**。手工起的容器只有容器名（`rag-prometheus`），没有 compose 服务别名 `prometheus`，而 Grafana 数据源指向 `http://prometheus:9090`，会解析失败并返回 502。正确做法是用 override 文件覆盖挂载：

```bash
docker compose -f docker-compose.monitoring.yml \
               -f /tmp/dc-transition.yml up -d prometheus
```

## 11. 使用步骤

```bash
# 1. 启动监控栈（Prometheus 9090 + Alertmanager 9093 + Grafana 3030）
cd monitoring && docker compose -f docker-compose.monitoring.yml up -d

# 2. 重启后端使埋点生效（含 @SkipTransform 与新增指标）
cd ../backend && npm run build && npm run start:prod

# 3. 打开界面
#    Grafana 看板:  http://localhost:3030/d/rag-overview   (admin / admin，本地已开匿名只读)
#    Prometheus:   http://localhost:9090                  (targets / alerts / graph)
#    Alertmanager: http://localhost:9093                  (静默、抑制、通知错误)

# 4.（可选）接钉钉/企微通知：起一个 sidecar 把 webhook 转成群消息
#    docker run -d -p 8060:8060 timonwong/prometheus-webhook-dingtalk \
#      --ding.profile="rag=https://oapi.dingtalk.com/robot/send?access_token=xxx&secret=yyy"
#    然后 curl -X POST http://localhost:9093/-/reload 或重启 alertmanager

# 5. 过渡期若后端暂时无法重启，用代理让 Prometheus 先有数据
#    （注意：必须二选一，不能与直连 job 同时开，见第 4 节）
cd backend && PORT=9101 UPSTREAM=http://localhost:3000/api/v1/metrics \
  node scripts/metrics-unwrap-proxy.mjs
```

## 12. 已知遗留

按重要性排序：

1. **需要重启两个服务**（唯一阻塞项）：`backend` 与 `admin-backend` 进程未重启，直连抓取仍会报 `expected equal, got ":"`。重启后：直连 target 变 up、新增指标（`rag_cache_*`、`rag_retrieval_duration_seconds`、带 `model` 的 LLM 指标）开始出现、记录规则里 LLM/检索/缓存那几条才会有数据。
2. **通知出口尚未接通**：`alertmanager.yml` 的 webhook 指向 `host.docker.internal:8060`，需要起钉钉/企微 sidecar 才会真正发出消息；现在 Alertmanager 会记录 notify errors（属预期，不影响规则评估）。
3. **看板没有模板变量**：目前是固定视图，没有 `service` / `route` 下拉过滤。数据源变量 `DS_PROMETHEUS` 已经有了，加业务过滤变量需要改 57 个面板的查询，建议后续按需增量做。
4. **无 exemplar**：histogram 样本里还没有挂 `trace_id`，无法从"某个慢样本"一键跳到调用链。项目已有 LangFuse / OTLP tracing，后续可在 prom-client 侧开启 exemplar 关联。
5. **无多窗口燃烧率告警**：当前是单阈值告警，尚未实现 SLO + 多窗口多燃烧率（`2%/1h` + `5%/6h` 这类）。数据已经够（`rag_http_requests:error_ratio5m` 记录的都有），属可增量增强项。
6. `backend/src/rag/agentic/agentic-rag.service.spec.ts` 仍按旧的构造函数参数个数实例化（少传参数），`tsc` 报 `Expected 12-18 arguments, but got 11`，属历史遗留，与本次监控改造无关。
7. `rag-admin.controller.spec.ts` / `karpathy-rag.service.spec.ts` 中另有少量历史类型错误（`tsc` 共 7 处，全在 spec 文件），生产构建口径 `tsconfig.build.json` 不受影响。
8. 若后续接入远端存储或多副本部署，告警里的 `up == 0` 需改成分片感知写法（如 `max by (job) (up) == 0`）。
