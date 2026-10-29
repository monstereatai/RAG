# RAG 能力边界与上下文流转

本文记录 2026-10-29 RAG 分层重构完成后的应用边界。设计依据是任务书、Agent Harness V3 的分层原则和 Context Engineering 对上下文来源、权限与预算的要求；最新源码和测试结果仍是最终事实来源。

## 1. 分层映射

| Harness 层 | 本项目入口 | 责任 |
| --- | --- | --- |
| L1 接入 | ChatController / gRPC / Gateway / AG-UI | 身份、租户、DTO、流事件和取消信号 |
| L2 编排 | ChatService / QueryPlanner / RetrievalPolicy | 选择模式，生成一次 QueryPlan 与 RetrievalExecutionPlan |
| L4 上下文 | Chat 上下文预算 / EvidenceBundle / ContextBuilder | 历史、Memory、RAG 证据的来源标记、裁剪与证据装配 |
| 线性 RAG 能力 | RagRetrievalService / RagEvidenceService / RagAnswerService | 召回、证据治理、受约束生成与降级；RagService 只做组合 Facade |
| Agentic 能力 | AgenticRagService + 四个 Agentic token | 状态机、子问题、反思、审批恢复和补充检索 |
| 索引与数据 | DocumentIndexCoordinator / Providers | PostgreSQL 权威数据、派生索引、补偿和对账 |

## 2. 组件边界

| 组件 | 单一职责 |
| --- | --- |
| `RagIndexService` | BM25 内存索引、`workspace/bm25-index.json` 持久化、索引写入/删除/统计 |
| `RagChunkPolicyService` | 片段 metadata、ACL/scope/lifecycle 可见性、来源权威、RRF、重排、章节扩展 |
| `RagRetrievalService` | 普通/计划/详细检索、BM25 兜底、描述命中回原文、检索来源编排 |
| `RagEvidenceService` | 充分性门禁、已审核纠错证据、引用校验/修复、确定性证据答案 |
| `RagObsidianService` | Obsidian 命中格式化、原文 source note 映射、编译知识片段转换 |
| `RagFastPathService` | Auto/Fast Path 并发取证、证据包与来源状态 |
| `RagDirectAnswerService` | Bad Case 精确纠错与受治理 BM25 直答门禁 |
| `RagAnswerService` | 线性问答用例编排，依赖上述窄服务，不持有索引或 provider 细节 |
| `RagAnswerFallbackService` | 联网/模型/Obsidian/会话状态/结构化兜底回答 |
| `RagGroundedAnswerService` | 已准备证据上的模型生成、引用门禁、语义/抽取式降级 |
| `RagService` | 只为组合接口保留的薄 Facade；不实现检索、证据或生成算法 |

`rag/contracts/rag-capabilities.ts` 定义稳定的能力契约：

- `RAG_QUERY_CAPABILITY`：`answer`、安全拒答文案。
- `RAG_RETRIEVAL_CAPABILITY`：普通检索、详细检索、审阅证据和充分性判断。
- `RAG_INDEX_CAPABILITY`：索引写入、删除、元数据更新、生命周期和统计。
- `RAG_ADMIN_CAPABILITY`：检索 + 索引的运营组合接口。

业务模块依赖 token，不依赖具体实现类。`RagModule` 将查询、索引和 Agentic 快路径 token 直接绑定到窄服务；检索、补充证据和 Admin 的组合 token 由 `RagService` Facade 组合。未来替换实现不应修改 Chat、gRPC、Admin、Document 等消费方。

## 3. 上下文与证据边界

- RAG 只负责产生已授权证据；ACL 和租户过滤发生在检索与最终证据返回两侧。
- `EvidenceBundle` 保留来源策略、诊断、子问题覆盖与充分性；生成器不能把候选召回片段直接当作已引用证据。
- 历史查询通过 `effectiveTime` 传入同一 RetrievalScope，普通查询继续按当前时间过滤。
- Chat 的系统上下文、短期摘要、Memory、历史检索和 RAG 证据分别标记来源；预算不足时优先保留必需规则。
- Run、Checkpoint、Artifact、Trace 不合并成同一个状态容器。

## 4. 完成边界

- `RagService` 已收敛为 406 行组合 Facade，只保留能力接口所需的委托方法。
- BM25 状态由 `RagIndexService` 独占；各检索/证据/回答服务不直接访问持久化文件。
- 回答编排按 Fast Path、直答、证据生成、兜底拆成独立服务，`RagAnswerService` 不再包含 provider 召回或索引细节。
- 能力 token 的消费方仍保持原方法签名；源码级契约测试、定向回归、构建和 smoke 脚本作为边界验证。
