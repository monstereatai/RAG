# 项目上下文工程

本文按上下文工程的层次描述本项目如何为一次回答或任务选择、组织和约束上下文。它参考了[Practical Guide to Context Engineering](https://github.com/WakeUp-Jin/Practical-Guide-to-Context-Engineering)的分层思路；本页只记录仓库中可定位的实现和边界。

## 1. 目标

模型质量不只取决于模型本身，也取决于每次调用拿到了什么信息、信息来自哪里、是否仍有效，以及是否能在权限和 Token 预算内使用。本项目把上下文分成提示词、当前请求、会话记忆、知识证据、工具结果、结构化输出和模型运行参数，并在生成前统一过滤与组装。

## 2. 上下文来源

| 上下文层 | 用途 | 主要实现入口 |
| --- | --- | --- |
| 系统指令与策略 | 定义回答约束、引用规则、提示词版本和注入防护 | `apps/rag-api/src/rag/prompts/`，包括 `prompt-registry.ts`、`context-policy.ts`、`prompt-injection.guard.ts` |
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
| 裁剪与预算 | 系统消息记录来源；上下文预算优先保留必需策略，再裁剪可选记忆和证据 | 字符／Token 估算是启发式，真实模型窗口仍需目标环境验证 |
| 压缩 | 会话超预算或超过消息阈值时压缩旧消息并保留近期原文 | 摘要用于连续性，不替代原始消息或业务知识来源 |
| 时间治理 | 通过文档版本、生命周期和有效时间过滤候选 | 时点问题应按查询时间语义匹配，而不是默认使用最新上传时间 |
| 隔离 | Tenant、用户所有权、文档 ACL 和请求身份进入读取路径 | 生产隔离结论仍以真实 IAM 和跨租户验证为准 |
| 不可信输入 | 检索内容与工具结果作为数据处理，提示词边界和注入检测提供防护 | 防护规则不是对任意恶意内容的数学保证 |

## 5. 记忆与知识分层

- **运行状态**：Run、Task、Runtime Event 和 LangGraph Checkpoint 服务于执行恢复，不等同于对话事实。
- **短期会话记忆**：近期消息和摘要帮助连续追问，完整消息另有持久记录。
- **长期偏好记忆**：保存适合跨会话使用的用户偏好，不自动升级为组织业务规则。
- **知识证据**：经授权、版本和生命周期治理的文档、图谱及知识页面，作为业务事实依据。

记忆应能被来源追踪、过期和删除；摘要或记忆召回不能覆盖当前有效证据。该设计对应分层记忆决策，具体持久化职责见[Agent Runtime](AGENT_RUNTIME.md)。

## 6. 面向本项目的实施顺序

1. 先确认上下文边界：身份权限、有效版本和当前请求。
2. 再选取证据：计划查询、并行召回、融合与去重。
3. 按预算组装：系统策略、必需证据、当前问题，再添加可选记忆或工具结果。
4. 生成后校验：结构、关键 Claim、来源引用和拒答条件。
5. 记录运行轨迹：区分成功、降级、跳过和失败，供评测与排障。

代码细节和最新验证以源码与[ROADMAP.md](../ROADMAP.md)为准；本页不是静态成熟度分数或线上质量承诺。
