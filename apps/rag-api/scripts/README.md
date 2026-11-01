# RAG API 脚本目录说明

本目录存放 RAG API 的评测、冒烟检查、数据集处理和运行证据采集脚本。它们是开发与验收工具，不属于 NestJS 服务的运行时代码。

文档说明使用中文。命令名、环境变量名、API 路径和数据字段保留代码中的原名，便于直接搜索和复制。

## 目录结构

```text
scripts/
├── *.mjs                 # 可执行入口：解析参数、调用流程、输出结果
├── README.md             # 本文档
├── lib/
│   ├── eval-rag-project-helpers.mjs
│   ├── project-eval-dataset.mjs
│   ├── evidence-utils.mjs
│   └── evidence-utils.test.mjs
├── private-fixtures/     # 合成私有夹具的生成逻辑
│   ├── common.mjs
│   ├── datasets.mjs
│   ├── documents.mjs
│   ├── graph-seed.mjs
│   ├── media.mjs
│   └── organization.mjs
└── fixtures/             # 本地 PDF、PPTX、视频等测试素材
    └── output/           # 视频冒烟测试产生的 WAV 音轨和 JPG 帧图
```

- 根目录保留脚本入口，以免改变 `package.json` 中已有命令和调用路径。
- `lib/` 放跨脚本复用的实现；仅用于生成私有测试夹具的代码放在 `private-fixtures/`。
- `fixtures/` 整个目录被 `.gitignore` 排除。`smoke-video-parse` 会在这里生成测试视频和输出音轨/帧图；本机静态 PDF、PPTX 等素材也放在这里。
- `mcp-smoke-server.mjs` 是供 MCP 冒烟检查使用的本地 stdio 测试服务。
- `metrics-unwrap-proxy.mjs` 是临时本地指标代理：把 API 统一响应里的 `data` 取出，转换为 Prometheus 可读取的纯文本。
  示例：`PORT=9101 UPSTREAM=http://localhost:3000/api/v1/metrics node scripts/metrics-unwrap-proxy.mjs`。

## 运行方式

从仓库根目录运行：

```bash
pnpm --filter backend run smoke:mcp
```

也可以进入 `apps/rag-api/` 后运行：

```bash
npm run smoke:mcp
```

命令名都定义在 `apps/rag-api/package.json`。带参数时，按命令说明使用 `--` 传入，例如：

```bash
npm run graph:import-business -- --dry-run
```

服务检查默认访问 `http://localhost:3000`。若脚本要求真实数据、登录凭证或外部服务，会在下方注明所需配置。

## 常见术语

| 术语 | 中文解释 |
|---|---|
| Smoke（冒烟检查） | 快速验证一条功能或服务链路是否能运行。 |
| Fixture（测试夹具） | 为测试准备的输入文件或数据。 |
| synthetic（合成） | 自动生成的测试数据，不代表真实业务数据。 |
| Mock（模拟服务） | 测试用的固定响应服务，不会调用真实模型或外部系统。 |
| dry-run（预演） | 只校验将执行的内容，不实际写入后端。 |
| Trace / Span | 一次请求的全链路追踪 / 链路中的单个步骤记录。 |
| LLM-as-Judge | 使用大模型评审回答是否有证据支持。 |
| P95 | 95% 请求的延迟都不超过的数值。 |
| Simple / Auto / Agentic | 项目中的三种聊天执行模式名称，作为参数时保持原样。 |

## 配置和契约检查

这些命令主要检查文件或配置形状，通常不需要启动 RAG API：

| 命令 | 用途 |
|---|---|
| `mcp:validate` | 检查 `workspace/mcp-servers.yaml` 格式，不会启动 MCP Server。用 `MCP_CONFIG_PATH=...` 指定其他配置。 |
| `docs:consistency` | 检查文档与代码入口的一致性。 |
| `contract:openapi` | 检查 OpenAPI 契约。 |
| `prompt:registry:check` | 校验 Prompt Registry。 |
| `tools:registry:check` | 校验工具注册表。 |
| `enterprise:readiness` | 汇总企业就绪检查项。 |
| `eval:golden:check`、`eval:langfuse:check`、`eval:business-dataset` | 检查相应评测数据是否符合生成结果和覆盖要求。 |

## 冒烟检查

冒烟检查用于确认某条服务、存储或外部集成链路是否能走通。部分命令会写入测试数据，运行前请看清下方说明。

### MCP、图谱和业务集成

- `smoke:mcp`：读取 `workspace/mcp-servers.yaml`，连接本地 MCP 测试服务并调用工具。
- `smoke:graph`：登录后导入 `eval/graph-smoke.seed.json`，检查图谱结构并执行 GraphRAG 查询；会写入图谱测试数据。
- `graph:import-business -- --dry-run`：检查 `eval/graph-business.seed.example.json` 或 `GRAPH_BUSINESS_SEED` 指定的文件，不调用后端。去掉 `--dry-run` 后会向运行中的 GraphRAG 后端导入数据。
- `graph:import-private`：对私有图谱种子执行 dry-run 校验。
- `smoke:dingtalk`、`smoke:mail:auth`、`smoke:auth:refresh`：分别检查钉钉、邮件认证和认证刷新相关链路。

### 检索、数据库和队列

- `smoke:milvus`：检查 Milvus 集合、Schema、索引元数据、集合加载状态、加载进度、SDK/服务端版本，并执行有上限的预热查询。首次向量检索超时时可用它定位；元数据正常但查询失败时，应继续排查 Milvus 运行状态、版本或 Segment 状态。
- `smoke:milvus:conversation-history`：只读检查 `conversation_chunks_v2` 中重复问题组，比较 `queryIterator` 前后的计数并读取最新选中行。只输出数量，不输出会话 ID 或内容；抽样范围内必须存在重复问题组，可通过 `MILVUS_HISTORY_SMOKE_SAMPLE_LIMIT` 扩大范围。
- `smoke:bad-case-milvus`、`smoke:es-knn`、`smoke:rag-pipeline`、`smoke:hybrid`：检查 Bad Case 向量、Elasticsearch KNN、RAG 主链路和混合检索。`smoke:hybrid` 会上传固定中文测试文档、检查检索结果，然后删除这些文档。
- `smoke:redis-checkpointer`：用另一个 Node 进程验证 Checkpoint 能否读到已保存状态。
- `smoke:bullmq-index-repair`：先构建后端，再使用独立进程和本机隔离 Redis DB 15，检查索引修复队列的临时失败重试、已完成任务去重，以及 Worker 被 `SIGKILL` 后任务恢复。只清理本次生成的随机队列、任务和计数键；不会重启 Redis，也不会触碰应用使用的 Redis DB。

### 语音、图片、视频和外部服务

- `smoke:speech`：调用后端 TTS SSE，再把生成的 WAV 发给后端 ASR。
- `smoke:speech:direct`：不启动后端，直接调用腾讯云 TTS 和 ASR；会使用外部服务。
- `smoke:external`：有密钥时调用 Bocha、DashScope Rerank 和 Qwen Judge；缺少密钥的检查会标记为跳过。
- `smoke:external:required`：与 `smoke:external` 相同，但缺少密钥会令命令失败。
- `smoke:embed-images`、`smoke:image-search`、`smoke:pdf-ocr`：检查图片向量生成、图片检索和 PDF OCR 链路。
- `smoke:video-parse`：离线检查视频解析；需要本机安装 `ffmpeg`/`ffprobe`，会生成测试视频，并把 stub 收到的音轨与帧图写入被忽略的 `scripts/fixtures/`。
- `smoke:vision-video`：检查私有多模态数据集是否包含图片、音频、视频及音视频转写 sidecar。只有要求必须使用真实 OCR/视频服务时，才设置 `VISION_VIDEO_REQUIRE_PROVIDER=true`。
- `smoke:langfuse`：检查 Langfuse 集成。

## 评测和数据集

### RAG 质量与 Agent 行为

- `eval:rag`、`eval:rag:e2e`：执行 RAG 评测和端到端链路检查。
- `eval:query-routing`：检查问题路由。
- `eval:rag:judge`：可选的 Qwen LLM-as-Judge，检查回答中的声明是否有证据支持；没有 `QWEN_API_KEY` 时会跳过。
- `eval:rag:project`：项目式评测，默认覆盖 Simple、Auto、Agentic。默认数据集标记为 synthetic（合成数据），只能作为回归证据，不能当成真实业务验收。用 `PROJECT_EVAL_DATASET` 选择数据集；设 `PROJECT_EVAL_REQUIRE_LIVE=true` 后，后端不可用时不会静默跳过。
- `eval:rag:quality`：本地质量门禁，运行离线 RAG 评测、120 条业务数据集检查和本地成熟度检查。设 `EVAL_RAG_JUDGE_REQUIRED=true` 后，Qwen Judge 变成必需项。
- `eval:rag:maturity`：本地企业成熟度评分，检查核心规范、业务评测覆盖、Smoke 入口、治理证据和外部阻塞。默认最低分为 90；只有生产目标、证书和备份材料已确认后才设置 `RAG_PRODUCTION_MATERIALS_CONFIRMED=true`。只有要求真实私有数据及生产材料必须通过门禁时，才设置 `RAG_MATURITY_REQUIRE_EXTERNAL=true`。
- `eval:agent-platform`、`eval:agent-tasks`、`eval:bad-case`、`eval:bad-case:long-term`、`eval:production-workflow`：分别检查 Agent 平台、任务指标、Bad Case 回归和生产工作流。长期 Bad Case 回归历史写入 `.tmp/evidence/bad-case-regression-history.jsonl`。
- `eval:conversation-context`：把经过审阅和脱敏的真实多轮数据集回放到本地 Chat API，对比全历史、近期历史、无历史和服务端持久历史等方案；统计关键词、引用、拒答规则检查及答案 Jaccard 稳定性。设 `expectCompaction:true` 可要求出现真实 `memory.compaction.completed` 事件并评测压缩后提问。通过 `CONVERSATION_EVAL_DATASET` 指定数据集，使用 `ACCESS_TOKEN` 或评测登录凭证；读取内部运行事件时还需 `CONVERSATION_EVAL_SERVICE_TOKEN` 或 `RAG_SERVICE_TOKEN`。增加 `-- --validate-only` 只检查数据格式，不调用 API。此评测不会模拟动态追问，也不提供语义 Judge 分数；报告不包含原始问题和回答。
- `eval:prompt-injection`：检查提示词注入防护。
- `eval:rag:multimodal`、`eval:rag:multimodal:private`：检查多模态 RAG；后者要求私有数据集中的素材齐全。
- `eval:golden-business`、`eval:business-private`：分别检查业务 Golden 数据和至少 50 条私有业务案例。

### Golden、LangSmith 和 Langfuse

- `eval:golden:generate`、`eval:golden:check`：生成或检查独立 Golden 数据集。
- `eval:golden:live`：启动在线 Simple 模式评测，要求后端可用。
- `eval:rag:langsmith`：运行稳定的本地 RAG 评测，并写出 `.tmp/langsmith-rag-eval.json`。设置 `LANGSMITH_TRACING=true`、`LANGSMITH_API_KEY` 和 `LANGSMITH_PROJECT` 后，LangChain/DeepAgents 调用会产生 LangSmith Trace。设置 `LANGSMITH_UPLOAD=true` 才会通过 REST API 上传 Dataset/Experiment；只有上传失败必须令 CI 失败时才设置 `LANGSMITH_UPLOAD_REQUIRED=true`。
- `eval:langfuse:generate`、`eval:langfuse:check`：生成或检查合成 Langfuse 可观测性数据集。
- `eval:langfuse:dataset`：构建后端，并对本地 Mock 接收端回放场景，检查 Trace/Generation/Span 序列化、Token/费用字段、脱敏、工具事件、生产工作流 Span、定时分析和禁用状态；不需要云端密钥。
- `eval:langfuse:experiment`：把合成案例同步到已配置的 Langfuse Dataset，对本地 Mock 接收端回放，并把逐条契约评分和总通过率写入 Langfuse Experiment。需要 Langfuse Cloud v4 或兼容的自托管 v4 凭证。它验证 Provider 序列化契约，不验证云端 Ingestion 传输或 RAG 答案质量。

### 业务数据集生成和导入

- `eval:business-dataset`、`game:dataset`：检查或生成业务、游戏营销回归数据集。
- `eval:business-import -- --input eval/business-regression.import.example.json`：检查业务评测导入文件。增加 `--write` 后，会保留 `items[]` 结构并生成 `documents[]`、`queries[]`，供 `PROJECT_EVAL_DATASET` 使用。每条可回答案例必须关联至少 80 个字符的来源文档。只有输入提供时才保留 `synthetic` 和 `provenance`，脚本不会自动把数据标记为真实或已审阅。私有数据完成脱敏后，才使用 `--write --min-cases 100`。
- `game:public-sources`、`game:top100`、`game:import-public-sources`：收集游戏营销公开来源、生成 Top 100 数据并导入来源。收集和导入会访问外部服务或写入数据。
- `graph:import-business`：检查示例图谱种子，支持 `GRAPH_BUSINESS_SEED` 指定其他文件；加 `-- --dry-run` 只校验，去掉 dry-run 才向运行中的后端导入。
- `fixtures:private:prepare`、`fixtures:private:check`：生成或检查合成夹具包，包括 193 条业务回归问题、多模态文件、GraphRAG 种子和组织权限数据。输出标记为 synthetic，不包含真实业务资料；清单写入 `eval/private-fixtures/manifest.json`。
- `graph:import-private`：对 `eval/private-graph-business.seed.json` 做 dry-run。

业务发布评测需要单独准备真实、授权、脱敏并经过人工复核的数据。至少包含 5 份来源文档、100 条唯一问题，覆盖拒答和冲突案例；可回答问题至少占 20 条且不少于总数的 20%。每条可回答问题必须设置 `requireCitation: true`、引用已存在的 `expectedDocIds`（或兼容字段 `sourceDocumentIds`），并提供 `expectedClaims`。发布门禁要求 Simple、Auto、Agentic 各模式及可回答子集都达到 `PROJECT_EVAL_MIN_SCORE`（最低 0.9），每种模式至少 90% 的结果有费用事件。门禁也会检查检索指标退化；A/B 费用和延迟上限必须显式配置。此检查验证数据声明，不会证明来源真实性；真实运行前必须由人工核验数据来源。

运行时，Judge 会通过标准输入收到本轮回答及其引用片段。只使用已脱敏数据；清理阶段会用登录凭证删除本轮上传的文档，任何文档删除失败都会令评测失败。

## 证据和性能

- `evidence:business`：把所选业务数据集上传到真实后端，按配置运行各聊天模式，并把脱敏后的 JSON/Markdown 证据写入 `.tmp/evidence/rag-business.*`。
- `evidence:stability`：通过真实 HTTP API 重复运行生产工作流，分别统计工作流完成、模型成功、降级、审批就绪、产物、证据覆盖和 P95。使用时提供 `ACCESS_TOKEN`。
- `evidence:operations -- redis,milvus-bad-case`：只运行白名单中的运维 Smoke，并把脱敏后的演练报告写到本地。受控故障演练可通过 `OPERATIONS_EVIDENCE_*` 增加演练信息。
- `evidence:readiness`：汇总业务、稳定性、性能、运维、ADR、跨团队、生产规模和事故证据；不会把缺失或模拟数据说成生产结论。
- `perf:rag`：采集 Simple、Auto、Agentic 的真实延迟样本，并写入 `.tmp/evidence/rag-performance.{json,md}`。本地工程阈值使用 `PERF_RAG_PROFILE=local`。严格模式的费用检查读取受保护 Run Center 上的 `cost.estimated` 事件，需要 `PERF_RAG_SERVICE_TOKEN` 或 `RAG_SERVICE_TOKEN`。费用是估算值，不是账单。
- 并发矩阵示例：将 `PERF_RAG_MODES` 设为 `simple,auto,agentic`，并分别把 `PERF_RAG_CONCURRENCY` 设为 `2`、`5` 或 `10` 运行。用 `PERF_RAG_OUTPUT=.tmp/evidence/load-<mode>-c<concurrency>.json` 分别保存结果。延迟在请求完成后读取 Run Center，不计入聊天延迟。
- `simulate:user-outcomes`、`simulate:production-closure`、`demo:production-workflow`：模拟用户结果、生产闭环或演示生产工作流；模拟结果不能作为真实生产验收证据。

同一问题的检索配置 A/B 对比需设置不同的 `PROJECT_EVAL_PROFILE_A` 和 `PROJECT_EVAL_PROFILE_B`，并提供 `PROJECT_EVAL_SERVICE_TOKEN` 或 `RAG_SERVICE_TOKEN`。脚本会检查两个 Profile 的有效配置确实不同，通过受保护的 `run-center/:id` 读取费用事件，并报告 Token 和估算费用差异；缺少费用事件时该结果标记为不可用，用户 JWT 聊天评测仍继续。问题两侧的运行顺序会交替；上传的测试文档使用唯一 `projectId`，确保两种配置查询同一批文档且符合登录用户 ACL。该方式是离线配对评测，不代表线上流量 A/B；没有置信区间，延迟为近似值。

## 运行边界

- 评测和冒烟脚本不得输出 API Key、Bearer Token、原始音频、向量或完整模型回答；报告应使用脱敏摘要。
- `smoke:hybrid`、图谱导入、业务评测、证据采集和 Langfuse Experiment 等命令会写入或删除测试数据；外部模型和公开来源命令可能产生网络调用及费用。优先先运行 dry-run 或数据格式检查。
- [项目运行、安全与交付文档](../../../docs/OPERATIONS.md) 说明可观测性、评测边界和运维验证入口；项目当前验证状态以根目录 [ROADMAP.md](../../../ROADMAP.md) 为准。
