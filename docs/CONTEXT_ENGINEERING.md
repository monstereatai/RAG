# 项目上下文工程

本文按上下文工程的层次描述本项目如何为一次回答或任务选择、组织和约束上下文。它参考了[Practical Guide to Context Engineering](https://github.com/WakeUp-Jin/Practical-Guide-to-Context-Engineering)的分层思路；本页只记录仓库中可定位的实现和边界。

## 1. 目标

模型质量不只取决于模型本身，也取决于每次调用拿到了什么信息、信息来自哪里、是否仍有效，以及是否能在权限和 Token 预算内使用。本项目把上下文分成提示词、当前请求、会话记忆、知识证据、工具结果、结构化输出和模型运行参数。问答主回答、查询规划、纠错回答、Agentic 充分性／反思、direct-answer、Mem0 分类和短期摘要／恢复有各自的完整输入预算预检；产研岗位调用会压缩前序结果与裁剪证据，产物编辑会在提交模型前检查完整 JSON/源码输入。HTTP 请求和主要 BullMQ 任务共享一次调用次数、估算输入 Token 与保守预留总 Token 上限；经 `LlmProvider` 发起的聊天模型 `invoke`、`stream`、`transform`、`batch` 与直接 Provider 调用都会计入。预算用于阻止失控调用，不负责判断哪些业务内容可以删。Token 按字符和图片数量估算，不是供应商账单；异步输入流无法准确预估内容量，独立视觉／Embedding SDK 调用也不由这套预算统计。

## 2. 上下文来源

| 上下文层 | 用途 | 主要实现入口 |
| --- | --- | --- |
| 系统指令与策略 | 定义回答约束、引用规则、提示词版本和注入防护 | `apps/rag-api/src/rag/prompts/`，包括 `prompt-registry.ts`、`context-policy.ts`、`prompt-injection.guard.ts` |
| Agent Skill 指南 | 按当前问题匹配项目维护的本地 `SKILL.md`，将命中的正文作为可选指导加入系统上下文 | `apps/rag-api/src/modules/skills/`、`apps/rag-api/src/modules/agent-runtime/agent-runtime.service.ts`、`apps/rag-api/src/modules/chat/chat.service.ts` |
| 当前请求与身份 | 保留用户问题、模式、租户／用户边界和本轮执行选项 | `apps/rag-api/src/rag/contracts/request-context.ts`、`apps/rag-api/src/rag/planning/query-plan.ts`、`apps/rag-api/src/modules/chat/chat.service.ts` |
| 会话与长期记忆 | 提供近期对话、压缩摘要、相关历史及用户偏好 | `apps/rag-api/src/modules/memory/short-term-memory.service.ts`、`apps/rag-api/src/modules/memory/memory.service.ts`、`apps/rag-api/src/modules/chat/conversation-embedding.service.ts` |
| 项目知识与证据 | 从已授权文档和可用索引中召回片段，保留版本、来源和引用 | `apps/rag-api/src/modules/document/`、`apps/rag-api/src/rag/retrieval/`、`apps/rag-api/src/rag/evidence/` |
| 工具结果 | 将搜索、MCP 和受控工具执行结果作为有来源的观察值回填 | `apps/rag-api/src/tools/tool-registry.ts`、`apps/rag-api/src/tools/tool-execution.service.ts`、`apps/rag-api/src/providers/mcp/` |
| 结构化输出与产物 | 对文档元数据、回答引用和工作流产物做格式或证据校验 | `apps/rag-api/src/modules/document/document-metadata.extractor.ts`、`apps/rag-api/src/rag/evidence/answer-quality.service.ts`、`apps/rag-api/src/modules/workflow/` |
| 模型调用信息 | 选择 LLM Provider，记录调用用量并应用调用策略 | `apps/rag-api/src/providers/llm/` |

这些入口不意味着所有上下文会进入每次调用。具体分支由 QueryPlan 的意图路由或工作流决定；前端不再手选问答模式。

## 3. 证据构建

文档进入系统后，解析、结构化切片、向量化并进入配置的索引。查询侧生成 QueryPlan 和检索策略，执行权限及生命周期过滤，再融合可用的向量、BM25、Elasticsearch、图谱或补充来源。证据进入 Evidence Bundle 后，系统会去重、保留来源和版本信息、按上下文预算选取，并在回答阶段检查引用支撑。

关键边界：

- 向量语义召回和 BM25／全文精确词召回互补；融合或重排只改变排序，不能放宽 ACL。
- 旧版本只有在查询语义、授权状态和有效期条件允许时才能作为证据；草稿与归档不应冒充当前有效规则。
- 联网搜索、图谱、Obsidian 等是可选证据来源，失败时应有明确降级状态。
- 找到相似文本不等于该文本支撑答案；重要 Claim 与引用须能回到实际证据片段。
- 实际链路、模式分支和数据状态见[功能步骤流程](interview/功能步骤流程.md)；总体模块关系见[系统架构](architecture/ARCHITECTURE.md)。

## 4. 上下文管理

| 管理动作 | 本项目的做法 | 主要边界 |
| --- | --- | --- |
| 选择 | 由 QueryPlan、检索策略、权限和证据充分性决定候选 | 用户无权读取的资料不能因高相关分数进入上下文 |
| 去重与排序 | 多路召回融合、候选去重、来源排序后再选取 | 保留来源信息，不能只保留无出处的拼接文本 |
| 裁剪与预算 | 主回答超限时依次裁剪旧历史、可选记忆和低排名证据；查询规划保留指令与当前问题、只裁旧历史；纠错回答保留安全指令、纠错事实、问题和必需策略消息，先裁旧历史再裁可选记忆；Agentic 充分性／反思保留问题、答案和固定指令，超限时按分数从低到高移除完整证据；direct-answer 固定提示与问题超限时跳过该直答，继续现有问答路由；Mem0 分类超限时不写记忆；会话摘要压缩／恢复超限时沿用失败处理，原始 PG 消息保留；命中的 Skill 正文与记忆、摘要一起竞争系统上下文预算，预算不足时整条 Skill 不注入；通用 Agent 工具结果最多 2,000 字符，超长时优先存为 Artifact 并向模型提供预览 | 业务层优先按内容重要性做裁剪；`LlmProvider` 再按配置的上下文窗口、最大输出和 10% 安全余量拦截单次输入，并在 HTTP 请求及主要 BullMQ 任务范围内限制累计调用次数、估算输入和总预留 Token。字符估算不是供应商精确 tokenizer；异步输入流的实际内容量及独立视觉／Embedding SDK 调用不在累计预算的准确统计范围。工具输出限制按字符而非 Token |
| 压缩 | 历史使用量超过分配预算的 90% 或超过消息安全上限时触发；目标回到约 70% 预算，并保留最近最多 30% 的原始消息（至少最近一问一答） | 按供应商/模型选择 `middle-removal`、`oldest-removal` 或 `hybrid`；仅 `hybrid` 再按对话特征选择。置信度低于 0.6 时同时试算中间移除与最旧移除，按 Token 减少分 × 0.6 + 消息保留分 × 0.4 打分；这两个值是权重，不是压缩比例。触发线 90%、目标 70%、最多保留约 30% 消息均基于启发式 Token 估算。逐消息优先级决定先删哪些消息，但首尾和长消息并非绝对保留。摘要保留当前目标、约束、下一步、变更、决策和待确认项，并限制摘要字段长度；压缩消息 ID 保留在既有摘要 JSON 中以防历史重放，摘要模型输入不传这些内部 ID。PostgreSQL 原始消息不删除。策略选择还没有真实会话摘要保真评测。 |
| 时间治理 | 通过文档版本、生命周期和有效时间过滤候选 | 时点问题应按查询时间语义匹配，而不是默认使用最新上传时间 |
| 隔离 | Tenant、用户所有权、文档 ACL 和请求身份进入读取路径 | 生产隔离结论仍以真实 IAM 和跨租户验证为准 |
| 不可信输入 | 检索内容与工具结果作为数据处理，提示词边界和注入检测提供防护 | 防护规则不是对任意恶意内容的数学保证 |

## 5. 记忆与知识分层

- **运行状态**：Run、Task、Runtime Event 和 LangGraph Checkpoint 服务于执行恢复，不等同于对话事实。
- **短期会话记忆**：PostgreSQL 保存会话原文和结构化摘要，是恢复依据；Redis 保存近期热窗口和摘要缓存，缓存校验失败时可从 PostgreSQL 重建，因此不是与 PostgreSQL 严格同步提交的第二份真相源。完整消息不会因摘要压缩而从 PostgreSQL 删除。
- **用户记忆**：Mem0 按 `userId` 写入跨会话 user scope。
- **会话记忆**：Mem0 按 `userId + conversationId/runId` 写入当前会话 session scope；LLM 分类器决定写用户层还是会话层，Outbox 负责失败重试与记录已完成 scope。user 记忆保存来源会话 ID、来源消息 ID 和记录时间；仅在用户原话明确一个绝对到期日且分类器确认它适用于整批 user facts 时，再写入 `rag_valid_until` 并于检索中过滤。Mem0 Cloud 请求只返回当前版本；自托管 Mem0 REST 不支持 `latestOnly`，本地模式仍没有事实级冲突裁决和周期归纳。session 记忆没有日期过期策略。外部 Mem0 写入与 Outbox 进度之间无法原子提交，若 Mem0 成功后、进度落库前进程崩溃，重放仍可能重复写入。
- **知识证据**：经授权、版本和生命周期治理的文档、图谱及知识页面，作为业务事实依据。

因此，代码有三类记忆/上下文来源：短期会话、用户记忆、会话记忆；只有短期会话历史会执行上述压缩。用户记忆与会话记忆按范围检索和写入，不是额外的压缩层。摘要或记忆召回不能覆盖当前有效证据。具体持久化职责见[Agent Runtime](AGENT_RUNTIME.md)。

## 6. 面向本项目的实施顺序

1. 先确认上下文边界：身份权限、有效版本和当前请求。
2. 再选取证据：计划查询、并行召回、融合与去重。
3. 按预算组装：系统策略、必需证据、当前问题，再添加可选记忆或工具结果。
4. 生成后校验：结构、关键 Claim、来源引用和拒答条件。
5. 记录运行轨迹：区分成功、降级、跳过和失败，供评测与排障。

代码细节和最新验证以源码与[ROADMAP.md](../ROADMAP.md)为准；本页不是静态成熟度分数或线上质量承诺。

## 7. Judge 评测的边界

在线 AgentEval 的忠实度分数按 Judge 返回的 `answerAssertions` 计算。服务要求 Judge 至少返回一条断言，但没有人工标注的答案事实清单，仍无法证明 Judge 覆盖了回答中的每一个事实主张；漏报断言会让分数偏高。因此该分数不能视为绝对可信结论。需求覆盖和上下文召回会逐项检查人工提供的标准要求与标准证据；黄金标准不完整时，指标同样会失真。重要决策应结合经审核的黄金样本、人工复核与独立留出集，不要只凭单次 Judge 分数判定质量。

## 8. 与参考指南的重点代码对照

这里对照的是代码中实际执行的职责，不以“模块已存在”当作完成证明。参考指南中的比例和阈值属于示例；项目采用的数值应由自身数据验证。

上游指南 `docs/` 下 43 篇 Markdown 已逐篇核对，包含不适用、空文件和重复文章；每篇的差距、代码证据及是否值得照做，见[全量文章对照](reference/CONTEXT_ENGINEERING_GUIDE_AUDIT.md)。

压缩重点对照：[Token 压缩策略](https://github.com/WakeUp-Jin/Practical-Guide-to-Context-Engineering/blob/main/docs/%E4%B8%8A%E4%B8%8B%E6%96%87%E7%AE%A1%E7%90%86/Token%E5%8E%8B%E7%BC%A9%E7%AD%96%E7%95%A5.md)和[上下文压缩调度](https://github.com/WakeUp-Jin/Practical-Guide-to-Context-Engineering/blob/main/docs/%E4%B8%8A%E4%B8%8B%E6%96%87%E7%AE%A1%E7%90%86/%E4%B8%8A%E4%B8%8B%E6%96%87%E5%8E%8B%E7%BC%A9%E8%B0%83%E5%BA%A6%EF%BC%9A%E5%B7%A5%E5%85%B7%E8%A3%81%E5%89%AA%E4%B8%8E%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95%E5%8E%8B%E7%BC%A9.md)。

| 文件 | 对应实践 | 当前实现与边界 |
| --- | --- | --- |
| `src/modules/memory/short-term-memory.service.ts` | 按预算触发压缩，保留最近原文，旧历史合成摘要；持久库为恢复依据，Redis 为热缓存 | 到触发线后批量压缩，目标约 70%，最多保留约 30% 原始消息；触发线是估算值。PostgreSQL 原文不删除，结构化摘要保存在已有 `contextSummary` JSON 文本列；Redis 是 24 小时热缓存，摘要重建可从 PostgreSQL 恢复。策略选择三层筛选已接通；逐消息优先级、摘要字段限长和内部压缩 ID用于控制重复上下文。稀疏 ID 达到 128 个时强制移除最旧连续前缀并推进水位线，避免摘要记录无限累积；从 PostgreSQL 校验近期历史时按 100 条分页读取，不截断消息 ID。新增真实会话评测可使用 `expectCompaction:true` 验证压缩事件，并统计压缩后的追问命中；当前没有真实数据结果，且命中规则不是语义保真判定。 |
| `src/modules/memory/memory.service.ts`、`src/modules/memory/memory.prompts.ts` | 分层记忆、事实写入轨迹和模型提示词可追溯 | classifier 的模型调用有输入预检；摘要保留目标/约束/下一步，user 记忆保存来源会话/消息和记录时间，并支持有限的显式绝对日期过期；云端搜索筛掉 superseded 版本。自托管 Mem0 没有 `latestOnly` 请求参数；事实冲突裁决和周期归纳仍缺。分类结果通过 Outbox 重试，外部写入与进度无法原子提交。 |
| `src/rag/planning/query-planner.service.ts`、`src/rag/planning/query-planner.prompt.ts` | 保留当前请求，按完整输入预算裁剪历史；规划输出使用受约束结构 | 只从旧对话开始裁剪；固定指令和当前问题保留。预算是按 tokenizer 估算，不是供应商精确计数。 |
| `src/rag/generation/grounded-answer-generation.service.ts`、`src/rag/answer/rag-grounded-answer.service.ts` | 先控制上下文，再回答；引用必须回到实际送入模型的证据；降级不能拼接两份半截答案 | 超限按旧历史、可选记忆、低排名证据裁剪；裁剪后的证据集用于引用校验与答案引用。主模型在输出首个 token 前失败才切备用；已经向前端发出部分答案后失败则让本次运行失败，避免“半段旧答案 + 完整备用答案”。语义蕴含检查仍不是独立人工标注或完整事实核验。 |
| `src/rag/agentic/agentic-rag.service.ts`、`src/rag/agentic/agentic-answer-generation.service.ts` | Agent 评估和直答也必须受上下文预算约束；中断不能被降级吞掉 | 充分性、反思和直答有完整输入预检；溢出时裁整段低分证据或跳过直答，不截掉用户问题。取消标记在运行中传成 AbortSignal，并在节点前后复核；模型/工具异常的降级分支先检查取消。图像/图谱补充证据没有统一走相同重排器，质量应由对照数据决定。 |
| `src/tools/tool-registry.ts`、`src/tools/tool-execution-policy.service.ts`、`src/tools/tool-execution.service.ts`、`src/modules/agent-loop/agent-loop.service.ts` | 工具定义、权限、超时、输出裁剪和可续读结果 | 单工具超时和权限在执行阶段生效；通用结果最多 2,000 字符，超长时存 Artifact 并返回预览/续读指引。明确交给程序 reducer 的结构化结果保持完整；字符数不等于 Token 数。 |
| `src/modules/agent-evals/agent-eval.dto.ts`、`src/modules/agent-evals/agent-eval.service.ts`、`src/modules/agent-evals/agent-eval.prompts.ts` | 代表性输入、黄金标准、Judge 指标和清晰的未评估状态 | 移除关键词重合伪装成忠实度/覆盖率的分数；没有启用 Judge 或缺少黄金标准时不判通过；Judge 按要求和标准证据逐项返回断言。现有样例集是合成数据，且单次 Judge 不能代替人工核验。 |
| `scripts/lib/project-eval-dataset.mjs`、`scripts/eval-rag-project.mjs`、`scripts/eval-rag-quality-gate.mjs` | 开发集和留存集分开报告，发布前检查留存效果 | 评测脚本拒绝没有 dev/holdout 标签或缺少留存样本的发布数据；示例比例不是通用行业门槛。真实业务留存集尚未准备，因此不能据此宣布生产质量达标。 |
| `src/rag/prompts/prompt-registry.ts`、`src/modules/chat/chat-run-observability.service.ts` | 将模型调用与实际提示词版本关联，评测能追溯变更 | 核心问答、规划、Agentic 判断、工作流、Judge 和记忆提示词按内容 hash 识别；记忆摘要仅在真实 LLM 调用的审计记录中写版本，不把旧摘要误标为新版本。它仍不是所有模型调用的全仓自动追踪器。 |
| `src/rag/indexing/rag-index.service.ts`、`src/providers/elasticsearch/elasticsearch.provider.ts`、`src/modules/rag-admin/index-reconciler.service.ts` | 证据来源可追溯，索引故障要可发现和修复 | ES/BM25 主写入错误向上反馈，审计对账覆盖持久化状态与生命周期；增量更新跨 PostgreSQL 和外部索引仍非原子，恢复依赖 reindex/reconciler；BM25 文件索引多实例共享和部分元数据差异仍有部署风险。 |

本轮代码完成后已通过 RAG 后端和管理端构建、提示词注册表检查及 `git diff --check`，没有运行单元测试。QA Ops 本地页面当前拒绝连接，RAG 开发 Compose 未启动；PostgreSQL 默认端口还被其他本地项目占用，因此真实登录后的 Simple/深度问答回放尚未完成。没有擅自启动会初始化数据库的栈，也没有执行数据库迁移。
