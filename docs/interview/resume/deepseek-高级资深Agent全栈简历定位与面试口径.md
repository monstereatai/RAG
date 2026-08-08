# Deepseek 简历项目定位与面试口径

> 目标岗位：**高级资深 AI Agent 全栈开发工程师 / 高级资深 AI 应用开发工程师**
> 本文档用于简历编写与面试准备。所有数字与结论对应项目真实状态（ROADMAP 口径），模拟数据与本地验证不冒充生产指标。

---

## 0. 投递方向与结论

- **结论**：本项目是这两个岗位最对口的简历项目，匹配度 90 分级，高于投泛化全栈。
- 这两个 JD 的「全栈」指 **Agent 应用全栈**（框架编排 + 接口 + 应用工程），不是 Web 前端全栈——所以前端薄不是致命伤。
- **最大软肋**：无真实生产数据、无真实并发压测、无生产部署。面试口径必须诚实（见 §5），绝不冒充线上指标。

---

## 1. 项目定位

### 30 秒版（一句话）

从 0 到 1 搭建的企业级 Agentic RAG 知识协同平台：多租户文档入库 → 混合检索 → Agentic 规划 → 多 Agent 产研运工作流 → 评测门禁闭环，覆盖权限隔离、Bad Case 飞轮、MCP 接入与可观测。

### 2 分钟版（展开口径）

- 技术栈：NestJS + LangChain/LangGraph + Milvus/pgvector + PostgreSQL + Elasticsearch + Redis + Neo4j + BullMQ + Mem0，前端 React/Vite，管理后台 React + Ant Design。
- 三条问答路径：`simple`（Karpathy 式低延迟）/ `agentic`（LangGraph 多步规划 + 联网兜底 + Rerank + 反思）/ `auto`（按 sufficiency gate 路由）。
- 多租户：以 `userId` 在 PostgreSQL、Redis、Milvus、BM25、Neo4j 全链路物理/逻辑隔离。
- 多 Agent：产研运六岗位（产品→设计→后端→前端→测试→运营）LangGraph FSM，结构化交付物、审批门禁、Redis Checkpointer 恢复、局部重跑。
- 评测：项目级仿真实业务评测 28/28、成熟度门禁 93/100、Agent Evals、Bad Case 飞轮、LLM-as-Judge。
- 工具化：rag-cli + rag-mcp-server（11 个 MCP 工具），供 Codex/Claude Code/Cursor 取上下文。

> 边界声明：以上为**本地工程闭环**数据。评测用模拟数据 + 本地回放，真实业务与生产指标仍在建设（见 ROADMAP「开放事项」）。

---

## 2. 三条深度主线（简历只露这三条）

> 每条 STAR 都要能讲到「方案对比 → 为什么这么选 → 实现 → 验证证据」。面试只取这三条主线，其余能力收敛为清单。

### 主线一：企业级 RAG 平台从 0 到 1

- **STAR**：
  - S：企业知识散落在 PRD/接口/制度文档，检索召回率低、上下文丢失、无权限边界。
  - T：从 0 搭建支持多租户隔离的 RAG 问答平台，答得准、答得稳、引用能撑住。
  - A：结构感知切片（父子 Section + 完整 headingPath）、混合检索（BM25/Milvus/ES + RRF 融合）、Agentic 规划（查询扩展、sufficiency gate、联网兜底、Rerank、Reflection 重试）、引用校验 + 低相关拒答、userId 全链路隔离、上下文预算 + Lost-in-the-Middle 排布。
  - R：项目级评测 28/28、多租户硬隔离通过测试、真实 SSE 流式闭环。
- **代码入口**：`backend/src/rag/karpathy/karpathy-rag.service.ts`、`context-builder.ts`、`bm25-store.ts`、`backend/src/rag/agentic/agentic-rag.service.ts`
- **验证命令**：`cd backend && npm run eval:rag:project`
- **可被追问的深度点**：chunk 策略选型（对比固定长度/递归/语义）、RRF vs 加权融合、sufficiency gate 怎么量化、Reflection 重试防死循环、Lost-in-the-Middle 的排布算法。

### 主线二：多 Agent 产研运工作流

- **STAR**：
  - S：需求到发布的产研运链路依赖人肉流转，交付物无结构、无审批、无恢复。
  - T：把产品/设计/后端/前端/测试/运营编排为可审批、可恢复、可局部重跑的多 Agent 工作流。
  - A：LangGraph 显式业务 DAG（设计/后端并行 → 前端等待 → 测试质量门禁 → 运营汇总）、每岗位独立检索工具 + 一次调用预算、结构化交付物 + 声明级证据门禁、`auto|required|risk_based` 审批、驳回回退、Redis Checkpointer 跨进程恢复、75 秒岗位预算 + 退避重试。
  - R：连续三次完整 DAG 18/18 模型调用成功、0 降级，总耗时 136.9~161.0 秒；工作流定向 10/10、backend 全量 40 suites / 177 tests 通过。
- **代码入口**：`backend/src/rag/agents/agent-pipeline.service.ts`、`researcher/analyst/writer/critic/editor.agent.ts`、`backend/src/modules/agent-ops-admin/`
- **验证命令**：`cd backend && npm run evidence:stability`
- **可被追问的深度点**：为什么 DAG 而非 Supervisor/Handoff、审批状态机怎么建模、Checkpointer 崩溃恢复怎么测、局部重跑的依赖边界、工具调用预算怎么分账。

### 主线三：评测与证据闭环（差异化亮点）

- **STAR**：
  - S：RAG/Agent 系统答得对不对没有客观口径，回归靠感觉。
  - T：建立「评测集 → 门禁 → Bad Case → 回归」闭环，让每次改动可验证。
  - A：项目级仿真实业务评测集（多文档/版本冲突/跨部门/拒答）、LLM-as-Judge claim 级校验、Agent 任务级指标（任务成功/忠实度/PRD 覆盖/工具成功/步骤准确）、成熟度门禁（查得准/答得稳/引用撑住/不瞎编/可观测/工程化）、Bad Case 人工审核入独立 Milvus collection 做 Few-Shot 纠错、错误归因 + 回归集标记。
  - R：评测 28/28、成熟度 93/100、LLM-as-Judge 7/7、Bad Case 检索闭环 2/2。
- **代码入口**：`backend/src/modules/agent-evals/agent-eval.service.ts`、`backend/src/rag/prompts/bad-case-flywheel.service.ts`、`backend/src/rag/prompts/prompt-injection.guard.ts`
- **验证命令**：`cd backend && npm run eval:rag:maturity`、`npm run eval:agent-tasks`
- **可被追问的深度点**：评测集怎么构造（防污染）、Claim 级校验怎么做、Bad Case 为什么用独立 collection 而非直接改 Prompt、门禁分数怎么构成、怎么防「评测过拟合」。

---

## 3. 简历怎么写（露什么、藏什么）

### 露

1. 三条主线各 1 条 bullet，按「业务场景 → 技术动作 → 价值/证据」写。
2. 技术栈一行带过：NestJS / LangGraph / Milvus / PostgreSQL / Elasticsearch / Redis / Neo4j / BullMQ / React。
3. 一句话点出「评测闭环」和「多租户隔离」，这是差异化。

### 藏

- 不写前端 MVP 细节（React/Vite 仅作技术栈提及）。
- 不写模拟数据规模数字（193/96 条、27 个文档）——会被当真实业务数据质问。
- 不写六岗位完整广度，只写「产研运多 Agent 工作流」一句话。
- 不写 93/100、28/28 旁边的「模拟」小字，但面试时必须主动讲清楚边界（见 §5）。

### 简历四条负责内容（可直接粘贴版）

- 从 0 到 1 搭建多租户企业级 Agentic RAG 平台：结构感知切片、BM25/Milvus/ES 混合检索、Agentic 规划与反思重试、引用校验与低相关拒答，项目级评测 28/28。
- 设计并实现产研运多 Agent 工作流（LangGraph DAG）：六岗位结构化交付、审批门禁、Redis Checkpointer 恢复与局部重跑，连续完整 DAG 18/18 模型调用成功、0 降级。
- 构建评测与证据闭环：Agent 任务级指标、LLM-as-Judge、Bad Case 飞轮与成熟度门禁，项目成熟度 93/100。
- 工具化与可观测：rag-cli + rag-mcp-server（11 个 MCP 工具）服务 AI 编程工具取上下文；Prometheus 指标 + traceparent 追踪 + pino 结构化日志。

---

## 4. 面试攻防清单

### 高频追问与标准回答

| 追问 | 标准回答要点 |
|---|---|
| 为什么不用 Dify/Coze/LangFlow？ | 平台锁死编排、无法深度定制评估与多租户隔离；自研换取对切片/检索/评测全链路可控。 |
| 向量库为什么选 Milvus？ | 支撑多租户标量过滤 + 向量检索、HNSW 索引、生产级运维；pgvector 作为降级备选（`VECTOR_STORE_PROVIDER` 切换）。 |
| sufficiency gate 怎么量化？ | 检索召回是否覆盖问题实体/关键词 + 置信度阈值，不满足触发联网搜索或 Agentic 升级。 |
| 怎么防幻觉？ | claim 级引用校验 + 低相关拒答 + Rerank 精排 + Bad Case Few-Shot 纠错。 |
| 多 Agent 为什么用 DAG 不用自由对话？ | 产研运有固定依赖顺序，DAG 可预测、可门禁、可局部重跑；协调开销可控。 |
| 审批驳回怎么回退？ | 状态机回退到指定节点 + Redis Checkpointer 保存节点状态，驳回后从该节点续跑。 |
| 记忆怎么分层？ | 短期 Redis 滑动窗口 + LLM 摘要压缩；长期 Mem0 分类写入，回答前注入相关记忆。 |
| 怎么证明答得对？ | 评测集 + claim 校验 + 门禁分数，Bad Case 回归集保证每次改动可验证。 |
| 成本怎么控？ | 每岗位一次工具调用预算、auto 路由避免长问题误触发高成本链路、token 估算指标。 |

### 不能硬说的边界

- **不主动说**「上线后准确率 98%」「生产压测 X QPS」——没有真实生产数据。
- 若被追问真实效果：答「当前是本地工程闭环 + 模拟评测，真实业务数据正在接入，评测方法已就绪」。
- 不把 28/28 说成线上准确率，口径是「项目级仿真实业务评测通过率」。
- 六岗位「连续 3 次完整 DAG 成功」是 Node 22 独立实例回放，不是生产 SLA。

---

## 5. 软肋与口径（必须诚实）

| 软肋 | 应对口径 |
|---|---|
| 无真实生产数据 | 「模拟数据保证工程闭环可验证，真实业务/评测集接入是当前开放事项，方法与门禁已就绪。」 |
| 无真实并发压测 | Milvus 偶发 timeout 已用快速失败 + 短期熔断 + BM25 降级兜底，稳定性 SLA 是开放事项。 |
| 前端深度薄 | 目标岗位的「全栈」指 Agent 应用全栈；前端仅作工程能力提及，不展开。 |
| 个人项目 vs 团队项目 | 若可挂靠真实业务场景按公司项目讲；否则定位「从 0 到 1 搭建平台原型」，不冒充团队协作成果。 |

---

## 6. 投递前 Checklist

- [ ] 简历只保留三主线 + 四条负责内容，其余收敛。
- [ ] 准备好 30 秒 / 2 分钟 / 追问三层回答，练习到能讲清「方案对比 → 为什么 → 验证」。
- [ ] 记住 3 个关键数字：28/28 评测、93/100 成熟度、18/18 模型调用成功。
- [ ] 确认每个「不能硬说」的边界口径，被逼问时不慌。
- [ ] 按目标公司 JD 定制：AI 应用岗多讲 RAG 全链路与评测；Agent 岗多讲多 Agent 编排与工具链。
