# 高级／资深／Staff Agent 岗位就绪度与补数手册

更新时间：2026-08-12

## 结论先行

**高级 Agent 开发／高级 AI 应用开发：项目主干完整，具备较强面试竞争力。**

**资深 Agent 架构岗位：可以进面试，但需要补真实业务结果、稳定性数据和架构决策深度。**

**专家／Staff 级：单靠当前项目还不够，需要真实规模、跨团队推进和线上事故治理证据。**

这三个判断不是按“功能数量”划分，而是按证据层级划分：

| 层级 | 面试官真正看什么 | 本项目当前状态 |
| --- | --- | --- |
| 高级开发 | 能否独立完成 RAG／Agent 主链路，并解释实现 | 主干已闭环 |
| 资深架构 | 能否用真实数据证明质量和稳定性，并解释架构取舍 | 工具已补齐，规模化证据仍要实际运行 |
| Expert／Staff | 能否在真实规模下推动多团队采用、治理事故、建立组织标准 | 需要真实工作经历和生产证据，不能由代码伪造 |

## 项目现在能讲到哪里

### 已经能硬讲的能力

- RAG：结构保护切片、父子 Chunk、向量＋BM25＋ES、多路融合、Rerank、上下文重组。
- 可靠回答：检索充分性、Claim 支撑、引用校验、低相关拒答、版本冲突提示。
- Agent：Simple／Auto／Agentic 路由、LangGraph 状态机、工具白名单、预算、超时、防循环、Checkpoint。
- 多岗位协作：产品、设计、前端、后端、测试、运营可独立使用，也可按 DAG 协作；只有重要任务才强制审批。
- 工程闭环：Bad Case、任务评测、Prometheus、trace、产物生成、内部／外部分享、管理后台。
- 架构决策：Workflow First、混合检索、证据门禁、分层记忆、降级恢复均有正式 ADR。

### 最新可展示的公开资料闭环

- 已建立 PC 端候选 Top50、页游候选 Top50 的公开资料目录，实际抓取 127 个官网／活动／运营／营销／社区页面。
- 108 份唯一目标文档已完成 PostgreSQL、Milvus、BM25／Elasticsearch、Karpathy 和 Obsidian 索引。
- Simple 链路有独立的 Karpathy Fast Path Markdown 方案，明确用户操作、服务端状态流、证据边界和与 Auto／Agentic 的升级边界。
- 面试表述仍需区分公开网页快照、本地仿真评测和真实企业生产数据，不能把公开资料入库结果包装成线上业务效果。

### 当前不能吹成生产成绩的内容

- 193 条企业数据和 96 条游戏活动数据是脱敏模拟集，不是真实用户问题。
- 一次真实 API 调用成功，不等于 30 天生产 SLA。
- 工作流超时后降级完成，不等于模型调用成功。
- 本地 Docker 的 QPS、P95 和恢复时间，不等于目标生产机器结果。
- 手工填写一份 JSON，不等于跨团队采纳或线上事故证据。

## 本轮已经实现的证据能力

| 能力 | 实现 | 输出 |
| --- | --- | --- |
| 真实业务 RAG 评测 | 上传真实资料，逐题调用真实 `/chat`，评关键词、Claim、引用、拒答、冲突和延迟，结束后清理资料 | `.tmp/evidence/rag-business.json` 和 `.md` |
| Agent 稳定性回放 | 重复调用真实六岗位工作流，区分工作流完成、模型成功、降级、审批就绪、证据覆盖、产物和 P95 | `.tmp/evidence/agent-stability.json` 和 `.md` |
| RAG 性能门禁 | 支持样本数、并发、错误率、吞吐、p50、p95 和阈值门禁 | `.tmp/evidence/rag-performance.json` 和 `.md` |
| 运维／恢复演练 | 白名单执行 Redis、Milvus、Bad Case、Hybrid、Graph、外部工具 smoke，记录演练元数据和结果 | `.tmp/evidence/operational-readiness.json` 和 `.md` |
| 岗位证据汇总 | 汇总业务、稳定性、性能、运维、ADR、生产规模、跨团队和事故证据，不自动填平缺项 | `.tmp/evidence/senior-agent-readiness.json` 和 `.md` |
| 架构决策深度 | 五份 ADR 记录背景、方案对比、选择、代价、指标和回滚条件 | `docs/architecture-decisions/` |

## 一、怎么补真实业务结果

### 1. 收集问题

从真实游戏官网／活动项目中收集至少 100 条，推荐分布：

| 类型 | 建议数量 | 例子 |
| --- | ---: | --- |
| 明确事实 | 20 | 活动时间、奖励、地区、版本 |
| 精确字段／数字 | 15 | 接口字段、埋点名、概率、库存 |
| 同义词／黑话 | 10 | 业务简称、项目代号、玩家口语 |
| 跨文档 | 15 | PRD＋接口＋设计＋测试联合回答 |
| 版本冲突 | 10 | 旧规则和新规则并存 |
| 无答案／应拒答 | 10 | 文档中不存在的承诺 |
| 多步推理 | 10 | 条件、例外、地区和时间组合 |
| 权限／角色 | 10 | 岗位可见范围和敏感内容 |

问题必须来自真实工单、评审、群聊、客服问题或项目复盘。可以脱敏，但不能把模拟问题改个公司名就称为真实。

### 2. 按现有 Schema 整理

```json
{
  "version": "game-project-2026-08-v1",
  "simulated": false,
  "items": [
    {
      "id": "real-activity-001",
      "category": "version-conflict",
      "department": "game-operation",
      "documentType": "prd",
      "query": "东南亚服周年庆抽奖每天最多几次？",
      "referenceAnswer": "以 V3 生效规则为准，每日最多 5 次。[片段1]",
      "referenceReferences": [{ "id": "activity-prd-v3" }],
      "expectedClaims": [
        {
          "text": "V3 生效规则每日最多 5 次",
          "supportKeywords": ["V3", "每日", "5 次"]
        }
      ],
      "expectedKeywords": ["V3", "5 次"],
      "minKeywordCoverage": 0.8,
      "requireCitation": true,
      "expectConflictHandling": true,
      "sourceDocument": {
        "id": "activity-prd-v3",
        "title": "周年庆抽奖 PRD V3",
        "content": "填写脱敏后的真实原文",
        "referenceIndex": 1
      },
      "ordinal": 1
    }
  ]
}
```

真实文件放在本地私有目录，不提交 Git。默认报告不会保存模型答案正文，只保存用例 ID 和指标。

### 3. 先校验，再真实调用

```bash
cd backend

node scripts/import-business-regression-dataset.mjs \
  --input /absolute/path/real-business.dataset.json \
  --min-cases 100

RAG_BUSINESS_DATASET=/absolute/path/real-business.dataset.json \
RAG_BUSINESS_MODES=simple,auto \
RAG_BUSINESS_MIN_PASS_RATE=0.90 \
RAG_BUSINESS_MIN_CITATION_RATE=0.95 \
npm run evidence:business
```

只有数据集包含 `"simulated": false`，或你明确设置 `RAG_BUSINESS_REAL_DATA_CONFIRMED=true`，报告才会从 `simulated` 升级为 `local_real_api`。标记生产还要额外确认：

```bash
RAG_BUSINESS_EVIDENCE_LEVEL=production \
RAG_BUSINESS_REAL_DATA_CONFIRMED=true \
EVIDENCE_PRODUCTION_CONFIRMED=true \
npm run evidence:business
```

### 4. 怎么形成简历可用结果

至少保留两个版本的报告：基线版和优化版。每次固定数据集版本，只改一个主要变量，例如 Chunk、Embedding、召回路数、Rerank 或阈值。

| 日期 | 数据版本 | 方案 | 通过率 | 引用率 | 拒答率 | P95 | 成本 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 基线 | v1 | 向量 TopK | 实测 | 实测 | 实测 | 实测 | 实测 |
| 优化 | v1 | Hybrid＋RRF＋Rerank | 实测 | 实测 | 实测 | 实测 | 实测 |

简历只写真实差值：`（优化后－基线）÷基线`。没有基线，不写“提升 30%”。

## 二、怎么补稳定性数据

### 1. 先跑 3 次调通，再跑 30 次形成证据

```bash
cd backend

ACCESS_TOKEN="填写登录得到的短期 token" \
AGENT_STABILITY_RUNS=3 \
AGENT_STABILITY_SCENARIO=dag \
AGENT_STABILITY_ENFORCE=false \
npm run evidence:stability

ACCESS_TOKEN="填写登录得到的短期 token" \
AGENT_STABILITY_RUNS=30 \
AGENT_STABILITY_CONCURRENCY=2 \
AGENT_STABILITY_MIN_WORKFLOW_SUCCESS_RATE=0.95 \
AGENT_STABILITY_MIN_MODEL_SUCCESS_RATE=0.90 \
AGENT_STABILITY_MIN_EVIDENCE_COVERAGE=0.80 \
AGENT_STABILITY_ENFORCE=true \
npm run evidence:stability
```

不要把 token 写进命令历史、文档、日志或 Git；推荐在当前 shell 临时导出，运行后 `unset ACCESS_TOKEN`。

### 2. 必须看的指标

- `workflowSuccessRate`：任务最终是否完成。
- `modelSuccessRate`：真实模型调用是否成功，不能被降级完成掩盖。
- `modelDegradeRate`：外部模型失败后走本地证据兜底的比例。
- `approvalReadyRate`：交付物是否达到审批条件。
- `averageEvidenceCoverage`：角色结论有多少被知识证据支撑。
- `artifactCreationRate`：最终产物任务是否创建。
- `p50Ms／p95Ms`：中位与长尾耗时。

同一配置至少跨三个时间窗口运行，例如上午、业务高峰、晚上。否则只能证明某一个时刻可用。

## 三、怎么补性能与真实规模

### 本地／预发性能

```bash
cd backend

PERF_RAG_SAMPLES=30 \
PERF_RAG_CONCURRENCY=5 \
PERF_RAG_SIMPLE_P50_MS=3000 \
PERF_RAG_SIMPLE_P95_MS=6000 \
PERF_RAG_AGENTIC_P50_MS=15000 \
PERF_RAG_AGENTIC_P95_MS=30000 \
PERF_RAG_MAX_ERROR_RATE=0.01 \
PERF_RAG_ENFORCE=true \
npm run perf:rag
```

阈值必须来自业务 SLA，不能为了绿灯无限放宽。报告会记录请求数、并发、成功率、错误率、吞吐、p50 和 p95。

### 生产规模

复制 `docs/evidence/real-world-evidence.example.json` 为本地文件 `docs/evidence/real-world-evidence.local.json`，填写真实 Prometheus、日志、账单和团队证据。该本地文件不应提交 Git。

必须补：

- 测量时间窗口和环境规格。
- 请求量、活跃用户、峰值 QPS、p95、错误率。
- 单次成功任务 Token／费用。
- 指标来源位置，保证面试时能解释怎么算出来。

## 四、怎么补架构决策深度

不要只说“用了 LangGraph、Milvus、Redis”。按下面顺序讲：

```text
背景和约束
候选方案
各方案优缺点
最终选择
为什么适合当前业务
付出的代价
用什么指标验证
什么情况下回滚或换方案
```

本项目五份 ADR：

1. `ADR-001-workflow-first.md`：为什么确定性流程不使用纯 ReAct。
2. `ADR-002-hybrid-retrieval-and-rerank.md`：为什么混合召回和重排分层。
3. `ADR-003-evidence-gated-answering.md`：为什么引用、Claim 和拒答是门禁。
4. `ADR-004-layered-memory.md`：为什么记忆不等于知识库。
5. `ADR-005-timeout-degrade-and-recovery.md`：为什么成功、降级和错误分开统计。

## 五、怎么补故障与恢复证据

### 连通与恢复 smoke

```bash
cd backend
npm run evidence:operations -- redis,milvus-bad-case
npm run evidence:operations -- hybrid,graph,external
```

### 受控故障演练

在本地或专用预发环境手工注入故障，再运行对应证据命令：

```bash
OPERATIONS_EVIDENCE_ENVIRONMENT=staging \
OPERATIONS_EVIDENCE_EXERCISE_ID=GD-2026-001 \
OPERATIONS_EVIDENCE_HYPOTHESIS="Rerank 不可用时应回退融合排序，回答仍带引用" \
OPERATIONS_EVIDENCE_INJECTED_FAILURE="在预发禁用 Rerank 出站访问 5 分钟" \
OPERATIONS_EVIDENCE_OPERATOR="填写负责人" \
npm run evidence:operations -- external,hybrid
```

推荐演练：Qwen 超时、Rerank／Bocha 不可用、Milvus 查询超时、Redis 重启、产物队列积压。不要直接在生产注入故障；生产操作必须走公司变更流程。

每次演练记录：发现方式、影响范围、时间线、降级是否生效、恢复时间、根因、改进项、负责人、截止时间和回归结果。

## 六、怎么补跨团队推进证据

代码只能提供协作机制，不能替你生成组织影响力。真实项目中至少保留：

- 产品、设计、前端、后端、测试、运营的 RACI 或责任边界。
- PRD 评审、接口契约、设计状态、测试门禁和发布复盘链接。
- 两个以上团队的接入记录和负责人。
- 上线前后交付周期、返工率、遗漏率、人工接管率或采用率。
- 你推动的统一规范、公共组件、评测门禁或排障手册。

把真实结果填入 `real-world-evidence.local.json` 的 `crossTeam` 和 `organization`，就绪度脚本只检查证据是否齐全，不替你发明结果。

## 七、怎么补线上事故治理证据

Staff 级不要求“制造事故”，但要求能证明你处理过复杂故障并让系统以后更难重犯。一次合格复盘至少包含：

| 内容 | 必须回答 |
| --- | --- |
| 影响 | 影响了哪些用户、任务、地区和时间 |
| 发现 | 指标、告警、客服还是人工发现，为什么没更早发现 |
| 时间线 | 发现、止损、定位、恢复分别是什么时间 |
| 根因 | 技术根因和流程根因，不写“模型不稳定”这种空话 |
| 止损 | 降级、熔断、回滚、人工接管是否有效 |
| 改进 | 代码、监控、测试、流程分别改什么 |
| 闭环 | 负责人、截止时间、验证证据和是否完成 |

只有真实生产事故才能把 `realProductionIncident` 填为 `true`。故障演练可以证明预案，但不能替代真实线上治理经历。

## 八、统一生成岗位证据报告

完成前面的实际运行后执行：

```bash
cd backend
npm run evidence:readiness
```

资深 Agent 架构岗默认验收：

- 100 条以上非模拟真实业务用例并通过门禁。
- 30 次以上完整 Agent 工作流重复回放并通过稳定性门禁。
- 每种 RAG 模式至少 30 次性能样本并通过 p50／p95／错误率门禁。
- 五份架构 ADR 完整。
- 至少两个依赖恢复／降级 smoke 通过。

Staff 级在此基础上额外验收：

- 有真实生产窗口、请求量和可追溯指标源。
- 至少两个团队的交付和量化结果证据。
- 至少一次真实线上事故复盘和改进闭环。
- 有被多个团队采用的平台、规范或公共能力。

门禁模式：

```bash
AGENT_EVIDENCE_ENFORCE=senior npm run evidence:readiness
AGENT_EVIDENCE_ENFORCE=staff npm run evidence:readiness
```

## 九、面试怎么说

### 当前阶段

> 这个项目的 RAG、Agent、多岗位工作流、评测和可观测主干已经完成，架构选择也形成了 ADR。当前我不会把模拟集和本地单次 smoke 说成生产成绩，所以又补了一层证据工具：真实业务逐题评测、30 次 Agent 回放、并发性能门禁、恢复演练和岗位就绪度汇总。现在工程能力是完整的，真实业务规模和生产组织证据要由实际项目运行补齐。

### 补齐资深岗位证据后

> 我不是只实现了 Agent 功能，还用固定版本的真实业务集做基线和回归，把工作流完成率与模型成功率拆开统计，并用 30 次重复回放、p95、错误率、证据覆盖率和恢复 smoke 做门禁。架构上每个关键选择都有候选方案、代价、验证指标和回滚条件。

### Staff 级正确说法

> Staff 的价值不只在一个项目代码量，而在跨团队杠杆。我会重点讲真实流量规模、多个团队怎么接入、我推动了什么统一标准，以及一次线上事故如何从止损、根因到机制改进闭环。没有这些真实证据时，我不会只凭本地项目自称 Staff。

## 十、真实业务补数清单

以下内容必须来自真实项目运行或真实用户反馈。代码和模拟数据只能提供采集工具，不能替代业务证据。

| 待补内容 | 必须记录 | 完成标准 | 主要证据来源 |
| --- | --- | --- | --- |
| 真实问题与标准答案评测集 | 问题、标准答案、标准证据、来源文档版本、期望引用、是否应拒答、业务分类 | 至少 100 条非模拟问题，覆盖事实、数字、黑话、跨文档、版本冲突、多步推理、权限和无答案场景 | 真实工单、评审记录、群聊、客服问题、项目复盘 |
| RAG 检索与回答质量 | Recall@K、MRR、nDCG、引用正确率、拒答准确率，并按场景分桶 | 固定数据集版本完成基线与优化版评测；每项指标有公式、样本量、阈值和原始报告 | `evidence:business` 报告、人工标注复核、Bad Case 集 |
| 六岗位稳定性与成本 | 任务成功率、模型成功率、降级率、P50／P95、单任务 Token 和费用 | 至少 30 次完整六岗位 DAG，跨三个时间窗口运行；成功与降级分开统计 | `evidence:stability`、LangFuse／Prometheus、供应商账单 |
| 用户与交付价值 | 采纳率、返工率、人工接管率、交付周期、节省工时，并记录统计周期和样本数 | 至少覆盖一个真实项目周期，并有上线前基线、上线后结果和产品／岗位负责人确认 | 任务系统、评审记录、工时记录、用户反馈 |
| 典型失败案例与优化对比 | 原始问题、错误输出、失败层级、根因、改动、优化前后指标、回归结果 | 至少沉淀 5 个不同类型 Bad Case，全部进入固定回归集且修复后不复发 | Bad Case 报告、trace、检索候选、版本化评测报告 |

### 指标口径

- `Recall@K`：标准证据是否出现在前 K 个召回结果中，按问题统计后求平均。
- `MRR`：第一个正确证据排名倒数的平均值，用于判断正确证据是否足够靠前。
- `nDCG@K`：同时考虑多个证据的相关等级与排序位置，适合衡量重排质量。
- 引用正确率：答案中的引用确实支持对应 Claim 的比例，不能用“有引用”代替“引用正确”。
- 拒答准确率：应拒答问题被正确拒答、可回答问题未被错误拒答的综合结果，需分别记录误答和误拒。
- 六岗位任务成功率：完整 DAG 达成业务验收条件的任务数除以总任务数，不能用 HTTP 200 代替业务成功。
- 用户采纳率：未经大幅重写而进入后续交付的 Agent 产物数除以总产物数；“打开过”不算采纳。
- 返工率：进入评审后因遗漏、错误或不可执行而退回修改的任务数除以已提交任务数。
- 节省工时：相同任务类型的人工基线工时减去使用平台后的人工投入；必须记录任务难度、样本数和统计周期。

### 基线与优化记录模板

| 数据版本 | 时间窗口 | 方案版本 | 样本量 | Recall@K | MRR | nDCG@K | 引用正确率 | 拒答准确率 | 六岗位成功率 | 降级率 | P95 | 单任务成本 | 采纳率 | 返工率 | 节省工时 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 真实集 v1 | 上线前基线 | baseline | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 |
| 真实集 v1 | 上线后同口径 | optimized | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 |

填写时必须保持数据集、评分规则和统计口径一致。面试只讲可追溯的绝对值和前后差值，不把模拟集结果包装成真实业务成绩。

## 十一、当前真实验证结果

2026-08-03 本轮小样本只验证工具可运行，不作为岗位达标数据：

- 真实 RAG API：1 条模拟业务 smoke，关键词、Claim 和引用校验通过；由于数据为模拟集，证据级别保持 `simulated`。
- 性能 smoke：Simple 2／2、Agentic 2／2 请求成功，但严格 SLA 未通过；说明错误率为 0 不等于延迟合格。
- 运维 smoke：Redis 跨进程 Checkpointer 与 Milvus Bad Case 读写检索 2／2 通过。
- Agent smoke：单岗位工作流完成、模型成功、产物排队；证据覆盖率 0.5、审批就绪率 0，稳定性门禁未通过。
- 六岗位模型稳定性：修复 Qwen 20 秒默认超时后，独立 Node 22 实例连续三次完整 DAG 共 18／18 模型调用成功、0 降级，总耗时约 136.9～161.0 秒；业务证据覆盖和审批就绪仍按独立质量指标评估。
- 五份 ADR 已存在并被就绪度脚本识别。

这些结果可以证明证据工具已经接上真实服务，不能替代 100 条真实业务集、30 次完整 DAG 和生产运行窗口。
