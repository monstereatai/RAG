# Window 1：面试证据与模型对比手册

本手册配合[Window 1 执行清单](./ai-agent-rag-window-1-agent-model-tools.md)，按 T00–T13 整理可由仓库证明的实现事实、面试准备方式和仍需本人/目标环境提供的证据。它不代替原面经问题，也不把源码存在当作生产效果。

## 使用边界

- **代码事实**：只描述当前源码和文档能证明的行为，按仓库版本复核。
- **验证事实**：注明实际运行过的静态检查、构建、smoke 或目标环境；未执行的命令不写成已通过。
- **个人事实**：职责、决策、团队分工、业务收益和职业动机只能由主人据实填写，代码无法推导。
- **真实效果**：真实模型、质量、延迟、成本、用户采纳、任务成功率必须来自授权数据和目标服务；合成 fixture 只能证明评测流程能运行。
- **安全边界**：写操作结果为 `unknown` 时禁止自动重试；内部 reconciliation 只在事件和 Redis 状态精确匹配时登记人工结论，不自动调用工具。MCP 通用 AgentLoop 调用层已接通，但当前业务决策器尚未消费工具目录；远端 Server 仍须实施并验证自身 ACL。

## T00–T13 逐项证据与准备

| 模块 | 仓库能证明的事实与主要证据 | 面试前准备/仍需补充 |
| --- | --- | --- |
| T00 项目叙事与职责 | 项目定位和系统链路见 `docs/PROJECT_BACKGROUND.md`、`docs/architecture/ARCHITECTURE.md`、`docs/interview/功能步骤流程.md`。 | 由本人填写：我负责的模块、做过的关键决策、协作边界、失败案例、结果证据。没有可信数据就不写用户规模、收益或性能数字。 |
| T01 Python/FastAPI | 按主人确认的范围，本项目不改 Python/FastAPI 及语言专属 API。 | 属于个人技术准备；不得把本仓库说成 Python/FastAPI 项目。 |
| T02 技术栈选型 | 项目技术栈在根目录 `CLAUDE.md` 锁定；组件和边界见架构文档及各 Provider/Module。 | 准备 NestJS、LangChain.js/LangGraph.js、Milvus、PostgreSQL、Redis、Elasticsearch 的选择理由、替代项、迁移成本和当前边界。用实际故障/改动举例，不声称做过未发生的迁移。 |
| T03 LLM 基础与推理 | Provider、请求预算、fallback、usage 处理见 `apps/rag-api/src/providers/llm/`；上下文估算边界见 `docs/CONTEXT_ENGINEERING.md`。 | 能解释上下文窗口、采样参数、工具调用、重试/fallback、Token 估算与真实账单的区别，并明确哪些是通用原理、哪些是本项目配置。 |
| T04 模型接入/选型 | `llm.provider.ts` 启动时校验当前 Provider Key；`llm-gateway.policy.ts` 只启用有 Key 的 fallback。评测入口包括 `scripts/eval-rag-project.mjs` 与 `scripts/benchmark-rag.mjs`。 | 真实质量/延迟/成本尚无本手册可引用结果。按下方 runbook 用同一授权数据比较；自部署/微调仅在目标 JD 确有要求时讨论。 |
| T05 Agent 与推理范式 | 受控执行循环见 `apps/rag-api/src/modules/agent-loop/agent-loop.service.ts`；查询路由/Agentic 计划见 `apps/rag-api/src/rag/agentic/`、`src/rag/planning/`。 | 准备真实运行轨迹，说明确定性 Workflow、Agentic 路径和直接回答各自适用范围；目前无真实轨迹就不声称任务成功率。 |
| T06 LangChain/LangGraph | Agentic RAG 状态图在 `apps/rag-api/src/rag/agentic/`；运行步骤、预算、取消与 checkpoint 见 `modules/agent-loop/`。 | 选一条真实执行链，按输入→状态→节点/边→模型或工具调用→结果归约→checkpoint/终止讲解。不要把通用 LangGraph 知识说成项目自定义能力。 |
| T07 多 Agent 协作 | 角色/依赖/消息等协作数据模型见 `apps/rag-api/src/modules/agent-collaboration/`；Supervisor 和 Agent Pipeline 见 `modules/supervisor/`、`src/rag/agents/`。 | 明确现有流程编排不等于自治 Agent 协商。只有真实跨 Agent 委派、冲突和协作收益样本才讲成功率；A2A 按目标岗位场景决定。 |
| T08 工具契约 | Tool Registry、权限/审批/超时/幂等和审计见 `apps/rag-api/src/tools/`；动态 MCP write 也按有效策略启用幂等；Agent Loop 对 `unknown` 停止后续动作。RAG 内部 route 为 `POST /api/v1/rag/admin/tool-execution/unknown/:callId/reconcile`；支持终态事件缺失的精确 orphan unknown marker，并可从唯一 `tool.call` 推导缺省 `runId`。 | Admin API 需加 `admin:qa-ops:write` 校验并从登录用户注入 operatorId，管理台入口仍未接；外部副作用是否完成必须查真实系统并留 evidenceRef，迟到提交与补偿也需实地验证。 |
| T09 MCP/A2A | `McpProvider` 要求逐工具 permission/risk/approval/modes/timeout/tenantScope；唯一 alias 会经 AgentLoop 的 ToolExecution wrapper 调用。tenant 工具要求可信 AgentLoop tenantId 和 schema `tenantId` 字段，调用时用服务端值覆盖模型输入。 | 当前业务 `decide` 回调没有实际选择 MCP alias；尚无统一 LLM `bindTools` dispatcher。AgentLoop 没有可信 approver 注入，因此写/高风险 MCP 调用会 fail-closed。远端 ACL、凭据范围和目标协议必须由 MCP Server/部署环境验证；本地 `smoke:mcp` 只证明 smoke server 连通及 status 工具可调用。 |
| T10 工具发现 | `apps/rag-api/src/tools/tool-registry.ts`、`modules/plugin-runtime/` 提供静态注册与插件工具白名单。 | 目前没有大规模真实工具目录的选择准确率、遗漏率、延迟和上下文成本证据。面试时说明当前使用边界，只有目录规模和评测集具备后再评估延迟加载。 |
| T11 Skills | `apps/rag-api/src/modules/skills/` 有内容 hash/版本和运行注入记录；`skillLimit` 有边界归一。 | 准备真实 Bad Case 的人审、修改、回归过程；失败反馈不会自动改写 Skill。没有真实闭环样例时只介绍流程，不宣称质量提升。 |
| T12 Prompt/结构化输出 | Registry 见 `apps/rag-api/src/rag/prompts/prompt-registry.ts`；显式模型调用将版本 metadata 传入 provider。 | 生产 trace 关联、脱敏和真实 prompt 回归仍需目标观测服务/样本。说明 Registry 如何记录版本，不把注册等同于 prompt 效果验证。 |
| T13 上下文工程/压缩 | 预算、裁剪、历史摘要、工具输出上限见 `apps/rag-api/src/providers/llm/llm.provider.ts`、`docs/CONTEXT_ENGINEERING.md`。 | 用授权多轮样本测事实保真、关键字段留存和 Token 估算误差；没有留存集时不要报摘要正确率。 |

## T04 模型对比 runbook

### 现有脚本能与不能比较什么

- `pnpm run eval:rag:project` 通过真实 Chat API 运行端到端评测，输出 pass/keyword/citation/refusal/conflict、检索命中/MRR/nDCG、平均/P95 延迟和运行成本估算。它每次只连接一个 `PROJECT_EVAL_BASE_URL`；可以在两套隔离服务上复用同一数据集做模型 A/B。
- `PROJECT_EVAL_PROFILE_A` / `PROJECT_EVAL_PROFILE_B` 比较的是两个检索配置，不是模型 Provider。不要把 profile A/B 报告解释为 Qwen/DeepSeek/智谱对比。
- `pnpm run perf:rag` 适合补测 Simple/Auto/Agentic 端到端延迟；它不是固定上下文的纯模型基准，也不能代替质量评测。
- 默认 `eval/project-simulated-business.dataset.json` 标记为 `synthetic: true`。不得用它声称真实业务模型质量或上线收益。
- `cost.estimated` 是估算成本；报告区分 Provider 报告 Token 与估算 Token，但仍需对账实际 Provider 账单。延迟是 Chat API 总耗时，包含检索和其他链路步骤，不是纯模型首 Token/P95。

### 开跑前准备

1. 获取有授权、已脱敏、人工复核的问题和来源文档；固定数据集文件、版本、query ID、split、评分规则与 `expectedClaims` / 引用来源。
2. 先调 development split；holdout 只用于冻结配置后的最终比较，不能反复用来调 prompt、检索或模型参数。
3. 准备两套隔离的 RAG API 实例，模型 Provider/模型名不同，其余代码版本、Prompt Registry、检索配置、用户/tenant 权限、上下文预算和并发条件保持一致。通过运行环境/secret manager 注入凭证，不修改或提交 `.env`，报告中不记录密钥。
4. 确认 A、B 实际请求使用的 Provider/模型；关闭或保持一致的 fallback 策略。任何一侧落入不同 fallback、运行版本不一致或数据 ACL 不同，该样本不应当作有效配对。
5. `eval:rag:project` 会上传本轮评测文档到随机 project scope，并在 `finally` 删除；仅在隔离评测服务及评测账号上运行。脚本使用独立 `EVAL_REPORT_DIR` 输出，避免两个运行互相覆盖 `project-rag-e2e-latest.json`。
6. 如果要作为项目发布质量门禁，`eval:rag:release` 当前要求数据集声明 `synthetic:false`、来源类型为 `sanitized_real_business`、人工复核标记及来源说明、至少 5 份文档和 100 个唯一 query ID，并包含拒答/冲突样本；可回答问题要有 `expectedClaims` 和有效关联文档 ID。门禁只能校验这些字段，不能独立证明数据确实来自真实业务，因此仍需保留人工来源审查。

### 单次模型评测命令模板

在 `apps/rag-api/` 下，为模型 A 与模型 B 分别运行同一命令；只替换 `PROJECT_EVAL_BASE_URL`、`EVAL_REPORT_DIR` 和服务端已配置的模型 Provider。`PROJECT_EVAL_DATASET` 应指向业务批准的数据文件，不能留空使用默认合成集。

```bash
PROJECT_EVAL_BASE_URL="http://127.0.0.1:3001" \
PROJECT_EVAL_DATASET="eval/approved/model-comparison.dataset.json" \
PROJECT_EVAL_REQUIRE_LIVE=true \
PROJECT_EVAL_SPLIT=development \
PROJECT_EVAL_MODES=simple,auto,agentic \
PROJECT_EVAL_SERVICE_TOKEN="<从安全凭证管理器注入>" \
PROJECT_EVAL_USERNAME="<隔离评测账号>" \
PROJECT_EVAL_PASSWORD="<从安全凭证管理器注入>" \
EVAL_REPORT_DIR=".tmp/evidence/model-comparison/model-a" \
pnpm run eval:rag:project
```

模型 B 使用第二个隔离服务地址和不同报告目录，例如 `.tmp/evidence/model-comparison/model-b`；数据文件、split、mode、query 顺序、服务代码和所有非模型配置保持一致。命令中的占位符不得写入 shell history、仓库、文档或报告；实际运行时应由本地凭证管理器设置变量。

如果暂时没有批准的真实评测集，可以先用现有合成集检查脚本和报告格式，但必须把产物标记为 `synthetic`，不能用于模型优劣结论或发布门禁。

### 记录和判读

| 字段 | 记录方式 |
| --- | --- |
| 实验身份 | 数据集路径/版本/hash、development 或 holdout、代码 commit、运行时间、服务实例、实际 Provider/model/fallback |
| 固定条件 | prompt version、retrieval profile/config、模式、temperature、max output、用户/tenant ACL、timeout、并发和重试 |
| 质量 | 样本数、总体及 per-mode pass rate、keyword accuracy、citation/refusal/conflict accuracy；检索适用样本另记 hit rate、MRR、nDCG |
| 时延 | 每个 query 的 Chat API duration、均值/P95、错误/超时率；纯模型耗时若无模型 trace 就填“不可得” |
| 用量与成本 | Provider token 数及覆盖率、估算 token 数、estimated cost/query、估算来源；实际账单需单独对账 |
| 结论 | 预先定义的质量非劣/提升门槛、延迟预算、成本上限、失败样本归因和复验决定；没有足够配对样本时结论写“样本不足” |

现有单次报告由 `EVAL_REPORT_DIR` 保存；模型 A/B 是两个独立报告，需要按相同 query ID 人工/脚本配对。现有 profile A/B 配对统计不等于模型 A/B 配对统计，也没有为跨实例模型对比提供置信区间。若需要统计显著性，需用足够样本和重复运行后另行分析，并保留原始逐条结果。

## 面试回答模板

每个项目问题按“背景/目标 → 本人负责部分 → 具体决策 → 执行链路 → 失败边界 → 验证证据 → 结果及局限”组织。所有带方括号的内容由本人填写；没有数据时直接说明“当前没有这项真实结果”。

```text
我参与的项目是【本人核验后的项目背景】。我实际负责【具体代码/决策及提交或工单证据】。
当时的问题是【真实问题】；我选择【方案】，主要权衡【成本/质量/安全/维护】。
请求经过【源码对应链路】，失败时由【实际保护/降级】处理。
我验证了【精确命令或目标环境证据】；结果是【可复核数据】。
限制是【真实数据/目标服务/统计口径尚未覆盖的部分】。
```

## 主要源码入口

- LLM Provider 与路由：`apps/rag-api/src/providers/llm/`
- Agent Loop 与运行时：`apps/rag-api/src/modules/agent-loop/`、`modules/agent-runtime/`
- Supervisor、协作与 Agent Pipeline：`apps/rag-api/src/modules/supervisor/`、`modules/agent-collaboration/`、`apps/rag-api/src/rag/agents/`
- 工具执行与策略：`apps/rag-api/src/tools/`
- MCP：`apps/rag-api/src/providers/mcp/`、`apps/rag-api/src/modules/mcp/`
- Skills 与 Prompt Registry：`apps/rag-api/src/modules/skills/`、`apps/rag-api/src/rag/prompts/`
- 项目评测与性能：`apps/rag-api/scripts/eval-rag-project.mjs`、`scripts/eval-rag-quality-gate.mjs`、`scripts/benchmark-rag.mjs`、`scripts/lib/eval-rag-project-helpers.mjs`
