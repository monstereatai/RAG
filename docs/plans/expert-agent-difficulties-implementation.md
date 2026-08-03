# 七项专家级 Agent／RAG 难点实现证据

> 本文记录附带材料中七项专家难点在当前项目里的真实落地。进度以 `ROADMAP.md` 为准，目标数字和模拟评测不冒充生产效果。

## 1. 产研运协作 LangGraph FSM

- 背景：产品、设计、前端、后端、测试、运营的交付物有严格依赖，纯 ReAct 容易跳步、越权和死循环。
- 选择：FSM 提供产品、设计、前端、后端、测试、运营六个可组合节点；支持单岗位独立执行，也支持任选多个岗位按产研依赖顺序协作，默认执行完整链路。节点内部再使用 LLM，每次只执行一个岗位，产出经 Zod 校验，失败最多重试 2 次。
- 控制：审批采用自动、全批次、风险／指定岗位三种策略；人工批准后前进，驳回可只重跑当前批次中的失败岗位；`maxSteps` 强制终止；Redis Checkpointer 保留 30 天并按 owner 隔离。启动与审批 API 快速返回 `running + threadId`，长耗时节点在后台执行，前端轮询稳定状态。
- 入口：`backend/src/modules/workflow/production-workflow.service.ts`，管理端 `/agent-ops`。
- 效果：真实 Qwen 已验证异步启动、挂起审批、批准恢复和最终完成；启动 4ms、审批命令 11ms 返回。单测覆盖单岗位独立执行、多岗位乱序输入规范化、DAG 并行、风险审批、局部重跑、证据降级、异步状态查询和 owner 隔离。

## 2. 快慢路径路由

- 背景：所有问题都跑 Agent 会提高首字延迟和成本，所有问题都走 simple 又无法处理复杂任务。
- 选择：`simple` 直接混合检索与生成；`auto` 先做 Fast Path 充分性判断，不足再升级 Agentic；`agentic` 强制进入图。
- 约束：扩展查询数、检索次数、chunk 数、联网结果、Rerank topN 和反思次数都有上限；超长自动问题降级 simple。
- 入口：`backend/src/rag/agentic/agentic-rag.service.ts`、`backend/src/rag/karpathy/karpathy-rag.service.ts`。
- 效果：项目真实服务回放 simple／auto 共 28／28 通过；首 token 进入 Prometheus 指标。

## 3. 混合检索与结构保护切片

- 背景：中文专有名词、缩写、版本号靠纯向量容易漏召回；表格、代码、接口契约被定长切碎后无法支撑引用。
- 选择：BM25／Elasticsearch 与向量检索经 RRF 融合，再做 Rerank；Chunk 保留完整 headingPath、父子关系、source span、表头和内容类型。
- 治理：支持同 Section／相邻块扩展、语义去重、单文档限额、来源多样性和 Lost-in-the-Middle 排布；向量失败降级 BM25。
- 入口：`backend/src/modules/document/chunking.util.ts`、`backend/src/rag/karpathy/`。
- 效果：结构切片与混合检索定向测试通过；真实项目回放覆盖版本冲突、缩写、跨文档、拒答和强引用。

## 4. 分层结构化记忆

- 背景：无限拼接历史会超上下文，只做自然语言摘要又会丢版本、决策和待办。
- 选择：超过约 2000 token 触发压缩，保留最近 6 轮原文；历史压成 facts、decisions、openIssues 和 sourceDigest。
- 字段：事实包含角色、模块、变更前后、版本、生效期和证据；模型失败时保留旧摘要与受限原文，不静默丢失。
- 入口：`backend/src/modules/memory/short-term-memory.service.ts`。
- 效果：结构化压缩和模型失败保底测试通过。

## 5. Agent Evals

- 背景：只测最终答案无法发现漏步骤、工具失败、未交接和证据不忠实。
- 选择：同时评估任务成功、faithfulness、PRD 覆盖、测试用例完整、工具成功、步骤准确和人工接管；可选 LLM-as-Judge。
- 入口：`backend/src/modules/agent-evals/`、`backend/eval/agent-task-regression.dataset.json`、`npm run eval:agent-tasks`。
- 效果：8 个 Agent 场景覆盖工作流、检索、坏例、工具降级、引用、拒答和记忆；任务／工具／步骤指标均为 1，门禁通过。

## 6. Bad Case 数据飞轮

- 背景：负反馈只存数据库不会改善后续回答，未经审核直接学习又会放大错误。
- 选择：用户反馈先进入待审池；只有负反馈、人工纠正、进入回归集且状态 reviewed／resolved 才写入独立 Milvus collection。
- 使用：生成前最多召回 2 条高相似历史坏例，提示词明确当前知识证据优先。
- 入口：`backend/src/modules/chat/rag-feedback.service.ts`、`backend/src/rag/prompts/bad-case-flywheel.service.ts`。
- 效果：Milvus `2.4.19` 与 Node SDK `2.4.10` 兼容组合下，真实审核链路与独立 smoke 均完成 embedding、insert、flush、向量命中、标量读回和临时数据清理。

## 7. 节点级可观测与死循环诊断

- 背景：只有整条请求耗时无法定位卡在哪个节点，SSE 多事件还可能把一次请求重复计数。
- 选择：每个 LangGraph 节点记录成功／失败、耗时和 SSE `node_timing`；记录首 token、工具调用、空召回、反思终止原因；同一 thread 聚合 trace，超过 15 节点标记 `span_limit`。
- 修复：HTTP Metrics／Tracing interceptor 使用 RxJS `finalize`，一次 SSE 只记录一次 HTTP 请求。
- 入口：`backend/src/modules/metrics/`、`backend/src/modules/tracing/`、`backend/src/providers/observability/langfuse.provider.ts`。
- 效果：真实 Agent 回放完整保留 7 个节点，同属一个 trace；HTTP 请求计数由修复前 76 次降为 1 次。

## 验证总表

| 验证 | 结果 |
|---|---|
| Backend 全量测试 | 37 Suites／163 Tests，通过 |
| admin-backend 全量测试 | 8 Suites／71 Tests，通过 |
| Backend／admin-backend／admin build | 全部通过 |
| Agent 定向能力测试 | 9 Suites／46 Tests，通过 |
| 项目真实服务回放 | simple／auto 28／28，通过 |
| 游戏官网／活动专项数据 | 8 文档／96 问题，校验通过 |
| 本地成熟度门禁 | 93／100，通过 90 分门槛 |
| 管理后台 | 工作流、Evals、Bad Case、trace 可用；1440px／390px 无横向溢出 |

## 未冒充完成的边界

- 外部 Qwen 在完整六岗位回放中仍出现 45 秒节点超时；平台会保留证据并生成明确的降级交付物，但模型服务延迟和成功率仍需用真实业务流量持续治理。
- `93/100` 是本地工程成熟度，不等于生产就绪；生产机器、证书、备份、密钥注入和正式监控仍需单独确认。
- 8 条 Agent 数据集和 96 条游戏专项问题是项目仿真数据，不冒充真实公司线上业务数据。
