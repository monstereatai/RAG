# RAG 服务 Grafana 面板清单

> 看板文件：`monitoring/grafana/dashboards/rag-overview.json`（uid: `rag-overview`，refresh 30s，默认时间范围 now-6h）
> 数据源变量：`DS_PROMETHEUS`（type=datasource, query=prometheus），所有面板均通过 `uid: "${DS_PROMETHEUS}"` 引用。
> 面板总数（不含 row 分组）：**57** 个。

窗口选择总原则：**5m 用于告警 / 实时排查口径**（约含 20 个抓取样本，兼顾平滑与灵敏度）；**1m 仅用于需要时间分辨率的热力图**；**1h 用于趋势与策略复盘**（低频事件需累计样本）；**6h 用于与看板默认时间范围对齐的累计报表口径**；**gauge / up / 比值类指标不套 rate，直接取最近样本**。

## 服务总览

| 面板标题 | 图表类型 | 完整 PromQL | rate / 统计窗口选择理由 |
| --- | --- | --- | --- |
| 服务存活实例数 (up) | 状态值 (stat) | `count(up == 1)` | 即时值，无 rate 窗口（取最近一次抓取样本 lastNotNull） |
| 总 QPS (5m) | 状态值 (stat) | `sum(rate(rag_http_requests_total[5m]))` | 5m — RED 告警标准窗口，约 20 个样本，兼顾平滑与灵敏度 |
| 5xx 错误率 (5m) | 状态值 (stat) | `sum(rate(rag_http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(rag_http_requests_total[5m])), 0.0001)` | 5m — 分子分母同窗口，避免假尖峰，与告警口径一致 |
| P99 延迟 (5m) | 状态值 (stat) | `histogram_quantile(0.99, sum by (le) (rate(rag_http_request_duration_seconds_bucket[5m])))` | 5m — 与告警口径一致，且保证尾部桶有足够样本 |
| LLM fallback 率 (5m) | 状态值 (stat) | `sum(rate(rag_llm_calls_total{status="fallback"}[5m])) / clamp_min(sum(rate(rag_llm_calls_total[5m])), 0.0001)` | 5m — 相对 1h 更快暴露主模型降级；LLM 低频故只作快速哨兵 |
| 请求量 Top route (5m) | 时序折线 (timeseries) | `topk(8, sum by (route) (rate(rag_http_requests_total[5m])))` | 5m — 趋势可读性与灵敏度平衡，避免抓取抖动毛刺 |
| 状态码分布 (5m) | 时序折线 (timeseries) | `sum by (status) (rate(rag_http_requests_total[5m]))` | 5m — 与总 QPS / 错误率同口径，便于交叉比对 |

## RED 指标

| 面板标题 | 图表类型 | 完整 PromQL | rate / 统计窗口选择理由 |
| --- | --- | --- | --- |
| 后端 QPS by route (5m) | 时序折线 (timeseries) | `sum by (route) (rate(rag_http_requests_total[5m]))` | 5m — RED 主口径，与告警面板统一 |
| 后端 5xx 速率 by route (5m) | 时序折线 (timeseries) | `sum by (route) (rate(rag_http_requests_total{status=~"5.."}[5m]))` | 5m — 告警标准窗口；绝对速率在流量骤降时仍可见错误 |
| 错误率口径对比: 5xx / 4xx (5m) | 时序折线 (timeseries) | `sum(rate(rag_http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(rag_http_requests_total[5m])), 0.0001)`<br>`sum(rate(rag_http_requests_total{status=~"4.."}[5m])) / clamp_min(sum(rate(rag_http_requests_total[5m])), 0.0001)` | 5m — 两个口径同窗口才可对比；与告警同口径 |
| 延迟分位 P50 / P90 / P99 (5m) | 时序折线 (timeseries) | `histogram_quantile(0.5, sum by (le) (rate(rag_http_request_duration_seconds_bucket[5m])))`<br>`histogram_quantile(0.9, sum by (le) (rate(rag_http_request_duration_seconds_bucket[5m])))`<br>`histogram_quantile(0.99, sum by (le) (rate(rag_http_request_duration_seconds_bucket[5m])))` | 5m — 三个分位同窗口可比；保证尾部桶样本充足 |
| 延迟分布热力图 (1m) | 热力图 (heatmap) | `sum by (le) (rate(rag_http_request_duration_seconds_bucket[1m]))` | 1m — 热力图追求时间分辨率以观察分布迁移；5m 会抹平形态变化 |
| Route 错误明细 Top20 (1h) | 表格 (table) | `topk(20, sum by (route, status) (increase(rag_http_requests_total{status=~"[45].."}[1h])))` | 1h — 明细表看累计量，让低频路由错误累积到可读量级；increase 自动补偿计数器重置 |
| admin QPS by route (5m) | 时序折线 (timeseries) | `sum by (route) (rate(admin_http_requests_total[5m]))` | 5m — 与后端 RED 同口径，便于双服务横向对比 |
| admin 5xx 错误率 (5m) | 时序折线 (timeseries) | `sum(rate(admin_http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(admin_http_requests_total[5m])), 0.0001)` | 5m — 与后端错误率同窗口，便于判定错误来源 |
| admin P99 延迟 (5m) | 时序折线 (timeseries) | `histogram_quantile(0.99, sum by (le) (rate(admin_http_request_duration_seconds_bucket[5m])))` | 5m — 与后端 P99 同窗口，用于定位慢查询归属 |

## 检索链路

| 面板标题 | 图表类型 | 完整 PromQL | rate / 统计窗口选择理由 |
| --- | --- | --- | --- |
| 检索耗时 P99 by stage (5m) | 时序折线 (timeseries) | `histogram_quantile(0.99, sum by (le, stage) (rate(rag_retrieval_duration_seconds_bucket{status="success"}[5m])))` | 5m — 与 RED 同窗口，便于把总延迟归因到具体检索阶段 |
| 检索成功率 by stage (5m) | 时序折线 (timeseries) | `sum by (stage) (rate(rag_retrieval_duration_seconds_count{status="success"}[5m])) / clamp_min(sum by (stage) (rate(rag_retrieval_duration_seconds_count[5m])), 0.0001)` | 5m — 比率型指标取告警标准窗口，避免低 QPS 下单次失败打到 0 |
| 召回分片数 P95 by stage (5m) | 时序折线 (timeseries) | `histogram_quantile(0.95, sum by (le, stage) (rate(rag_retrieval_recalled_chunks_bucket[5m])))` | 5m — 稳态指标平滑；5m 足以看清各路召回量相对关系 |
| 命中速率 by source (5m) | 时序折线 (timeseries) | `sum by (source) (rate(rag_retrieval_hits_total[5m]))` | 5m — counter 速率与全局同口径，用于识别长期未生效的检索源 |
| 命中的 mode 占比 (1h) | 饼图 (piechart) | `sum by (mode) (increase(rag_retrieval_hits_total[1h]))` | 1h — 占比复盘需大样本稳定；increase 给出直观绝对量 |
| 上下文分片数均值 by intent (5m) | 时序折线 (timeseries) | `sum by (intent) (rate(rag_retrieval_context_chunks_sum[5m])) / clamp_min(sum by (intent) (rate(rag_retrieval_context_chunks_count[5m])), 0.0001)` | 5m — _sum/_count 同窗口求均值；与告警口径一致 |
| 上下文字符数 P95 by intent (5m) | 时序折线 (timeseries) | `histogram_quantile(0.95, sum by (le, intent) (rate(rag_retrieval_context_characters_bucket[5m])))` | 5m — 容量类尾部指标需持续观察；P95 避免均值掩盖超长上下文 |
| 扩展分片速率 by intent (5m) | 时序折线 (timeseries) | `sum by (intent) (rate(rag_retrieval_expanded_chunks_total[5m]))` | 5m — counter 速率，与上下文规模面板对照定位膨胀来源 |

## LLM 调用

| 面板标题 | 图表类型 | 完整 PromQL | rate / 统计窗口选择理由 |
| --- | --- | --- | --- |
| LLM 调用量 by provider + model (5m) | 时序折线 (timeseries) | `sum by (provider, model) (rate(rag_llm_calls_total[5m]))` | 5m — 与告警口径对齐；LLM 稀疏，更短窗口会锯齿化 |
| LLM 状态分布 (5m) | 时序折线 (timeseries) | `sum by (status) (rate(rag_llm_calls_total[5m]))` | 5m — 与调用量同窗口，三态相加可校验口径一致性 |
| LLM fallback / error 率 (5m) | 时序折线 (timeseries) | `sum(rate(rag_llm_calls_total{status="fallback"}[5m])) / clamp_min(sum(rate(rag_llm_calls_total[5m])), 0.0001)`<br>`sum(rate(rag_llm_calls_total{status="error"}[5m])) / clamp_min(sum(rate(rag_llm_calls_total[5m])), 0.0001)` | 5m — 比率型告警指标；低频场景下 5m 是稳定比率的最优折中 |
| LLM 耗时分位 P50 / P95 / P99 (5m) | 时序折线 (timeseries) | `histogram_quantile(0.5, sum by (le) (rate(rag_llm_call_duration_seconds_bucket[5m])))`<br>`histogram_quantile(0.95, sum by (le) (rate(rag_llm_call_duration_seconds_bucket[5m])))`<br>`histogram_quantile(0.99, sum by (le) (rate(rag_llm_call_duration_seconds_bucket[5m])))` | 5m — 趋势级哨兵；精确容量评估交给 1h 面板 |
| Token 速率 prompt + completion (5m) | 时序折线 (timeseries) | `sum by (provider, type) (rate(rag_llm_tokens_estimated_total[5m])) * 60` | 5m — counter 速率并换算为 tokens/min；5m 平滑单次长输出突刺 |
| Token 消耗 Top model (1h) | 条形图 (barchart) | `topk(10, sum by (model) (increase(rag_llm_tokens_estimated_total[1h])))` | 1h — 成本复盘看累计量；increase 覆盖低频模型不被 Top 排序漏掉 |
| LLM 耗时 P95 by provider + model (1h) | 时序折线 (timeseries) | `histogram_quantile(0.95, sum by (le, provider, model) (rate(rag_llm_call_duration_seconds_bucket[1h])))` | 1h — 跨模型横向对比需充足样本让分位稳定；5m 的差异多为样本噪声 |

## 缓存

| 面板标题 | 图表类型 | 完整 PromQL | rate / 统计窗口选择理由 |
| --- | --- | --- | --- |
| 缓存命中率 by cache (5m) | 时序折线 (timeseries) | `sum by (cache) (rate(rag_cache_requests_total{result="hit"}[5m])) / clamp_min(sum by (cache) (rate(rag_cache_requests_total[5m])), 0.0001)` | 5m — 比率型指标；命中率下跌早于延迟上升，需与 RED 同窗口关联 |
| 缓存请求速率 by cache + result (5m) | 时序折线 (timeseries) | `sum by (cache, result) (rate(rag_cache_requests_total[5m]))` | 5m — 与命中率同窗口，用于区分 miss 增多还是 hit 减少 |
| 命中 / 未命中占比 (1h) | 饼图 (piechart) | `sum by (result) (increase(rag_cache_requests_total[1h]))` | 1h — 占比复盘需大样本稳定，用于量化缓存收益 |
| 缓存操作耗时 P95 by cache + operation (5m) | 时序折线 (timeseries) | `histogram_quantile(0.95, sum by (le, cache, operation) (rate(rag_cache_operation_duration_seconds_bucket[5m])))` | 5m — 缓存应毫秒级；5m 足以稳定暴露尾部劣化（网络抖动/大 key） |
| 缓存操作 QPS by operation (5m) | 时序折线 (timeseries) | `sum by (cache, operation) (rate(rag_cache_operation_duration_seconds_count[5m]))` | 5m — 与缓存其它面板同口径；_count 与 _bucket 配对分析 |
| 缓存命中率汇总 (6h) | 表格 (table) | `sum by (cache) (increase(rag_cache_requests_total{result="hit"}[6h])) / clamp_min(sum by (cache) (increase(rag_cache_requests_total[6h])), 0.0001)` | 6h — 与看板默认时间范围（now-6h）对齐，用于稳定报表口径 |

## Agent 与任务

| 面板标题 | 图表类型 | 完整 PromQL | rate / 统计窗口选择理由 |
| --- | --- | --- | --- |
| Agent 节点耗时 P95 by node (5m) | 时序折线 (timeseries) | `histogram_quantile(0.95, sum by (le, node) (rate(rag_agent_node_duration_seconds_bucket[5m])))` | 5m — 与告警口径一致；节点样本稀疏故用 P95 而非 P99 |
| Agent 节点错误率 by node (5m) | 时序折线 (timeseries) | `sum by (node) (rate(rag_agent_node_duration_seconds_count{status=~"error|failed"}[5m])) / clamp_min(sum by (node) (rate(rag_agent_node_duration_seconds_count[5m])), 0.0001)` | 5m — 比率型告警窗口；避免低 QPS 节点单次失败即 100% 的误报 |
| 首 Token 耗时 P95 by route (5m) | 时序折线 (timeseries) | `histogram_quantile(0.95, sum by (le, route) (rate(rag_agent_first_token_duration_seconds_bucket[5m])))` | 5m — 体感指标需稳定尾部读数；1m 会因并发低而在桶边界跳动 |
| 工具调用速率 by tool + status (5m) | 时序折线 (timeseries) | `sum by (tool, status) (rate(rag_agent_tool_calls_total[5m]))` | 5m — counter 速率；与节点耗时面板交叉定位延迟来源 |
| 工具错误率 by tool (5m) | 时序折线 (timeseries) | `sum by (tool) (rate(rag_agent_tool_calls_total{status=~"error|failed"}[5m])) / clamp_min(sum by (tool) (rate(rag_agent_tool_calls_total[5m])), 0.0001)` | 5m — 比率型告警口径；工具失败常不产生 5xx，需独立盯守 |
| Agent 循环终止原因 (1h) | 饼图 (piechart) | `sum by (reason) (increase(rag_agent_loop_terminations_total[1h]))` | 1h — 低频离散事件需累计样本；5m 大多数窗口为 0 不可读 |
| 空检索速率 by route (5m) | 时序折线 (timeseries) | `sum by (route) (rate(rag_agent_empty_retrieval_total[5m]))` | 5m — 与命中速率对照；更短窗口下事件稀疏呈孤立尖峰 |
| 定时任务执行速率 by task_kind + status (5m) | 时序折线 (timeseries) | `sum by (task_kind, status) (rate(rag_scheduled_job_runs_total[5m]))` | 5m — 用于确认任务按时出现；异常判定需结合 1h 失败率面板 |
| 定时任务失败率 (1h) | 时序折线 (timeseries) | `sum by (task_kind) (increase(rag_scheduled_job_runs_total{status=~"fail|failed|error"}[1h])) / clamp_min(sum by (task_kind) (increase(rag_scheduled_job_runs_total[1h])), 0.0001)` | 1h — 定时任务频率低，窗口需覆盖至少一次调度（天级任务应放大到 24h） |
| 定时任务耗时 P95 by task_kind (1h) | 时序折线 (timeseries) | `histogram_quantile(0.95, sum by (le, task_kind) (rate(rag_scheduled_job_duration_seconds_bucket[1h])))` | 1h — 任务样本每分钟 0~1 个，只有 1h 能让分位桶非空，避免 NaN/阶跃 |
| 危险查询拦截速率 by pattern (5m) | 时序折线 (timeseries) | `sum by (pattern) (rate(rag_dangerous_queries_blocked_total[5m]))` | 5m — 安全指标需高灵敏度，1 分钟内发现集中攻击尝试 |
| 危险查询拦截累计 (6h) | 状态值 (stat) | `sum(increase(rag_dangerous_queries_blocked_total[6h]))` | 6h — 与看板默认时间范围对齐，用于交接与周报的绝对次数 |

## 资源与运行时

| 面板标题 | 图表类型 | 完整 PromQL | rate / 统计窗口选择理由 |
| --- | --- | --- | --- |
| 进程内存 RSS by instance (5m 均值) | 时序折线 (timeseries) | `avg by (instance) (rag_process_resident_memory_bytes)` | 5m — gauge 降采样为可读水位曲线，过滤瞬时噪声（非 rate 语义） |
| Node 堆内存 used / total | 时序折线 (timeseries) | `rag_nodejs_heap_size_used_bytes`<br>`rag_nodejs_heap_size_total_bytes` | 即时值，无 rate 窗口（gauge 直接取最近样本；套 rate 无意义） |
| 堆内存使用率 | 状态值 (stat) | `rag_nodejs_heap_size_used_bytes / clamp_min(rag_nodejs_heap_size_total_bytes, 1)` | 即时值，无 rate 窗口（gauge 比值，反映瞬时水位） |
| Event Loop Lag P99 by instance (5m max) | 时序折线 (timeseries) | `max by (instance) (max_over_time(rag_nodejs_eventloop_lag_p99_seconds[5m]))` | 5m — 取 max_over_time 峰值确保瞬时尖刺不被平均；而非 rate |
| GC 耗时速率 (5m) | 时序折线 (timeseries) | `sum by (instance) (rate(rag_nodejs_gc_duration_seconds_sum[5m]))` | 5m — _sum 是 counter，rate 得到 GC 时间占比；5m 平滑单次 GC 抖动 |
| 进程运行时长 | 状态值 (stat) | `time() - rag_process_start_time_seconds` | 即时值，无 rate 窗口（两个即时值相减，重启探测） |
| 进程 CPU 使用 (5m rate) | 时序折线 (timeseries) | `sum by (instance) (rate(rag_process_cpu_seconds_total[5m]))` | 5m — CPU 累计秒是 counter，rate 得核数；5m 平滑 Node 单线程突发 |
| 服务存活 by job (up) | 时序折线 (timeseries) | `min by (job) (up)` | 即时值，无 rate 窗口（0/1 状态；min by job 收敛多实例） |

## 专题一：P99 为什么必须用 histogram_quantile

### 1. 原理

prom-client 的 Histogram 不是保存每个样本，而是在进程内把每个观测值累加进一组**累计计数器**，暴露为 `<name>_bucket{le="<上界>"}`。也就是说，服务端只保留了「耗时 ≤ 上界的请求有多少个」这类累计信息，**原始样本已经丢失**。因此：

- 无法用 `avg` / `quantile` 这类把样本当独立点处理的函数得到 P99；
- 唯一正确的做法是用 `histogram_quantile(φ, sum by (le, ...) (rate(<name>_bucket[WINDOW])))`，让 Prometheus 在桶上做**线性插值**估算分位点。

正确写法（本看板统一口径）：

```promql
histogram_quantile(0.99, sum by (le) (rate(rag_http_request_duration_seconds_bucket[5m])))
```

按维度拆分时必须把维度标签写进 `by`：

```promql
histogram_quantile(0.95, sum by (le, stage) (rate(rag_retrieval_duration_seconds_bucket[5m])))
```

### 2. 三个必守规则

1. **必须保留 `le`**。`sum by (le)` 里漏掉 `le` 会把所有桶压成一个值，`histogram_quantile` 直接返回 NaN。
2. **必须先聚合再取分位**。先对每个 label 组合分别 `histogram_quantile` 再取最大值，得到的是「各组合分位的最大值」，不是全局分位，语义完全错误。
3. **rate 窗口要足够长**，否则尾部桶常年为 0，插值退化为「最大非空桶」，P99 会出现阶跃式跳变。

### 3. 分桶不合理会怎样让 P99 严重失真

`histogram_quantile` 的插值**只能在已有桶边界之间进行**，它对桶外的世界一无所知。两种典型错误：

**错误 A：最大桶上界太小（契约里的反例——最大桶只到 30s，真实请求有 60s）**

设 buckets 最大上界为 `le="30"`，理想情况下 60s 的请求会落进 `+Inf` 桶。

- `+Inf` 桶没有「上界」，只表示「> 30s 的全部请求」；
- 当 P99 落在 `+Inf` 桶时，`histogram_quantile` 只能返回**最大已定义上界（30s）**作为近似；
- 结果：真实 P99 = 60s，看板显示 ≈ 30s，**误差 2 倍且永久封顶**。延迟涨到 120s 也只会显示 30s，尾延迟劣化被完全掩盖。

**错误 B：桶过粗且集中在低延迟区**

buckets 只有 `[0.1, 1, 10]`，真实 P99 = 0.9s。P99 落在 `(0.1, 1]` 桶内，Prometheus 在该桶内做均匀分布假设并线性插值，得到约 `0.1 + 0.9 × (0.99N − C_{0.1}) / (C_1 − C_{0.1})`。由于桶内真实分布是长尾而非均匀，插值结果可能偏离真实值数十个百分点——**桶越粗，桶内均匀假设越失真**。

**推论**：分位精度上限由分桶密度决定，而不是由查询算得多准决定。想要 P99 可信，就必须让 99% 的数据点落在**有明确上下界的桶内**，而不是 `+Inf`。

### 4. 不同量级服务如何设置 le 分桶

设计原则：**把 p95~p99 的目标值放在有上下界的桶里，并用「近等比数列」覆盖一个数量级以上的范围；桶数控制在 10~20 个**（桶太多会显著增加 series 数量与存储成本）。

| 服务类型 | 典型延迟量级 | 建议 buckets（秒） | 说明 |
| --- | --- | --- | --- |
| 轻量 CRUD / 缓存命中接口 | 1ms ~ 200ms | `0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1` | 低延迟区需要密集桶；最大桶取 1s，超过 1s 即视为异常，无需再细分 |
| 常规 API（含数据库查询、外部 RPC） | 20ms ~ 3s | `0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 5` | 覆盖两个数量级，0.2~1s 是核心观测区，需要更密的桶 |
| 含 LLM 的长请求 / RAG 全链路 | 0.5s ~ 120s | `0.5, 1, 2, 3, 5, 8, 10, 15, 30, 60, 120` | 尾延迟是常态，必须把 30s / 60s / 120s 显式设为桶，**绝不能让 `+Inf` 兜底**；上游还要配超时，避免出现 > 120s 的观测 |
| 定时批处理任务 | 1s ~ 30min | `1, 5, 10, 30, 60, 120, 300, 600, 1800` | 按分钟级等比扩展；分位面板的 rate 窗口必须 ≥ 任务调度周期，否则桶为空 |

**落地检查清单**

- [ ] 最大桶上界 ≥ 业务超时值（否则 P99 被永久封顶）；
- [ ] 分位目标区间（p90~p99）有至少 2~3 个桶边界；
- [ ] 所有 histogram 的桶在**同一服务内保持一致**，便于跨指标对比；
- [ ] 改桶配置属于破坏性变更：旧桶与新桶的 `_bucket` series 会被 Prometheus 视为不同时间序列，切换瞬间分位图会出现跳变，建议在发布记录中标注。

> 契约中 `rag_http_request_duration_seconds` 的 buckets = `0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 5, 8, 10, 15, 30, 60, 120` 正是按「含 LLM 的长请求」档位设计的：0.05~1s 覆盖检索阶段，1~10s 覆盖 rerank / 短 LLM 输出，15~120s 覆盖长输出与全链路，最大桶 120s 保证 P99 不会被封顶在 30s。

## 专题二：高基数 label 禁忌

### 1. 为什么禁止把 user_id / request_id / query 原文 / session_id / docId 放进 label

Prometheus 的时间序列由 **指标名 + 完整 label 集合** 唯一确定。每出现一个「新 label 组合」，就会创建一条独立的时间序列，并长期占用内存、磁盘与索引。因此：

- `user_id`、`request_id`、`session_id`：基数等于用户数 / 请求数 / 会话数，属于**无界基数**。10 万用户就是 10 万倍 series，且只增不减。
- `query` 原文：几乎每个请求都不同，基数等于请求总数，是最恶劣的一类。
- `docId`：等于文档总量，且会随知识库增长持续膨胀。

### 2. 具体后果

1. **时间序列爆炸**：一个 counter 加上 `user_id` 后，series 数 = 指标数 × 用户数 × 其它标签组合数。原本 5 条 series 的指标可能瞬间变成 500 万条。
2. **Prometheus 内存被打爆**：活跃 series 常驻内存（每条约 1~3KB 量级）。百万级 series 会直接导致 OOM，或迫使你被动扩容 / 缩短期留存，反而丢失关键监控数据。
3. **查询变慢甚至超时**：`sum by (route)` 这类聚合必须先扫描并物化所有匹配 series，series 越多，`rate()` / `histogram_quantile()` 越慢；Grafana 看板随之整体卡顿。
4. **远程写成本飙升**：remote write 按样本条数计费 / 计带宽，高基数会把成本放大几个数量级，同时拖慢写入队列，造成采集侧背压。
5. **TSDB 索引膨胀**：倒排索引随 label 值数量增长，重启恢复时间变长，compaction 压力上升。

**量化例子**：`rag_agent_tool_calls_total{tool,status}` 只有约 20 种组合，是非常健康的指标；一旦改成加上 `session_id`，100 万会话 × 20 = 2000 万条 series，**监控系统本身会成为最大的故障源**。

### 3. 这些信息应该放在哪里

| 维度 | 正确落点 | 说明 |
| --- | --- | --- |
| `request_id` / `trace_id` | **日志** + **trace（OpenTelemetry / Jaeger / Tempo）** | 用于单请求级串联排查；Grafana 中通过 trace ↔ metric 跳转关联，而不是把它做成 label |
| `user_id` / `session_id` | **日志**（结构化字段）+ **trace attribute** | 需要按用户聚合时走日志系统（Loki / ES）或数据仓库，不要走 Prometheus |
| `query` 原文 | **日志** + **exemplar**（只截断保留短摘要） | 用 exemplar 把「某些异常慢样本」的原始上下文挂到 histogram 桶上，采样率极低，不产生有界基数爆炸 |
| `docId` | **日志** + **trace attribute** + 文档元数据库 | 召回质量分析放在离线评估流水线，不在监控热路径上做 |
| 需要关联的原始上下文 | **exemplar** | exemplar 随样本写入，只在被采样时出现，天然受控；配合 `trace_id` 可一键从指标跳到具体 trace |

### 4. 允许作为 label 的维度（受控枚举）

低位、受控、取值可枚举且数量稳定的维度才允许进 label，例如：

- `method`（GET / POST / PUT / DELETE / …）
- `route`（**路由模板**，如 `/api/v1/rag/query`，绝不能是原始 URL `/api/v1/rag/query?q=xxx&userId=123`）
- `status`（HTTP 状态码、success / fallback / error）
- `provider`、`model`、`type`、`node`、`tool`、`stage`、`cache`、`result`、`intent`、`task_kind`、`pattern`
- `le`（histogram 桶边界，由 buckets 配置决定）

**判断标准**：这个 label 的取值集合是否「有限、已知、长期稳定在几十个以内」？答案为否，就不要把它做成 label。

### 5. 工程兜底建议

1. 采集侧对 `route` 做**路由归一化**：把路径参数替换为模板（`/doc/:id`），并把未匹配路由统一归入 `__unmatched__`，从源头堵住基数泄漏。
2. 对 `pattern` / `model` 等标签做**枚举白名单**，未知值统一落到 `unknown`，避免上游传入自由文本。
3. 在 Prometheus 侧用 `metric_relabel_configs` 丢弃或改写意外出现的标签，作为最后一道防线。
4. 配置 cardinality 监控（`prometheus_tsdb_head_series`），为 series 增长设置告警，做到事发前发现。
