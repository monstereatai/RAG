# 面试文档使用说明

更新时间：2026-08-11

> 第一次进入面试材料请先看 [README.md](./README.md)。本文件保留更详细的阅读场景、问题定位和复习方法。

## 先看结论

如果目标是 **高级 Agent 开发 / 高级 AI 应用开发**，不要把所有文档从头背到尾。按下面三层用：

```text
1. 临场回答：INTERVIEW_PLAYBOOK.md
2. 真正理解：AI_AGENT_CORE_KNOWLEDGE.md
3. 对照 AgentGuide 和项目边界：docs/interview/agentguide-rag-interview-mapping.md
```

一句话：

```text
INTERVIEW_PLAYBOOK.md 负责“怎么说”，AI_AGENT_CORE_KNOWLEDGE.md 负责“为什么”，agentguide-rag-interview-mapping.md 负责“AgentGuide 问到时怎么和项目对上，并且哪些不能吹”。
```

到 2026-07-30 为止，高级 Agent 开发通用主干已经闭环：RAG、Agentic RAG、Deep Research 边界、Agent Harness、Evaluation Harness、Memory、Tool/MCP、Skill、框架选型、合规型 Agent、安全沙箱、多模态证据定位、数据合成 / 评测集构建、企业工作流落地和生产化边界都已覆盖。后续只需要按具体公司 JD 做定制化补强。

## 这几份文件分别干什么

| 文件                                                               | 用途                                                                                                              | 什么时候看                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `docs/interview/AI_TOOLING_INTERVIEW_GUIDE.md`                     | Agent、多 Agent、Function Calling、Tool、MCP Server、Skill 六部分关系、伪代码、业务场景、失败治理、评测和代码对照 | 面试官集中追问 Agent 架构、多 Agent 协作、外部能力、MCP 和 Skill 时 |
| `docs/interview/AGENT_ARCHITECTURE_SELECTION_GUIDE.md`             | Agent 平台总架构、方案图、Workflow／ReAct／Manager／Handoff／DAG／Supervisor 等模式对比、主流场景和选型           | 面试官追问“为什么这样设计、还有哪些架构、不同场景怎么选”时          |
| `docs/interview/USER_ARCHITECTURE_INTERVIEW_QUESTION_INVENTORY.md` | 主人历次架构与面试问题按主题汇总，标注覆盖状态、答案入口、真实数据项和建议新增问题                                | 面试复习前查漏补缺、决定下一步补什么时                              |
| `docs/interview/SEVEN_DIFFICULTIES_INTERVIEW_GUIDE.md`             | 七个 Agent／RAG 技术难点的业务背景、方案对比、项目选择、实现证据、口述稿和追问答案                                | 面试前集中复习项目技术深度，或面试官追问“为什么这样设计”时          |
| `docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md`               | 高级／资深／Staff 岗位边界，真实业务、稳定性、性能、ADR、跨团队和事故证据的补数命令与验收线                       | 判断项目能投什么级别、补简历数字、准备架构岗或 Staff 追问时         |
| `AI_AGENT_CORE_KNOWLEDGE.md`                                       | 高级 Agent / RAG 核心知识人话版：概念、方案、优缺点、项目取舍                                                     | 系统复习、被深挖原理和方案选型时                                    |
| `docs/interview/agentguide-rag-interview-mapping.md`               | AgentGuide 高频知识与当前项目对照：覆盖度、项目证据、边界、回答模板                                               | 面试官按 AgentGuide 体系追问 RAG / Agent / MCP / Memory / Eval 时   |
| `INTERVIEW_PLAYBOOK.md`                                            | 面试回答稿：核心问题清晰回答版、项目介绍、高级 Agent 速背页、追问回答、反问清单                                   | 面试前背诵和临场组织语言                                            |
| `docs/interview/resume/resume-rag-project.md`                      | 简历可复制版本：项目名称、项目描述、最终版 bullets、量化指标                                                      | 写简历、改简历、投递前                                              |
| `docs/interview/resume/resume-rag-project-game-marketing.md`       | 更贴合主人游戏活动/营销/官网经历的简历版本                                                                        | 投 AI 应用、Agent、前端架构、业务中台相关岗位时                     |
| `docs/interview/resume/game-marketing-rag-evidence.md`             | 游戏活动/官网营销专项证据：数据集、评测维度、MCP、多 Agent、边界                                                  | 面试官追问“为什么这个项目贴合你的过往业务”时                        |
| `docs/interview/jd/jd-requirements-project-mapping.md`             | 对照大厂 JD：岗位要求、项目实现、代码位置、面试边界                                                               | 投递前、面试前判断岗位匹配度                                        |
| `docs/interview/jd/jd-gap-implementation-status.md`                | 看缺口状态：哪些已补、哪些只是基础版、哪些仍需外部条件                                                            | 面试官追问“还有哪些没做完”时                                        |
| `docs/interview/processon-ai-application-mindmap.md`               | ProcessOn「AI 应用」思维导图逐节点整理和项目对照                                                                  | 面试前按知识地图查漏补缺时                                          |
| `docs/interview/开源项目参考能力归档.md`                            | Dify、RAGFlow、AutoGPT、MetaGPT、CrewAI、AutoGen 的参考能力、当前项目融合方式、未照搬部分和生产边界                  | 面试官问“为什么参考这些项目”“为什么不直接引入框架”时，或统一复习平台治理、检索和多 Agent 设计时 |
| `docs/interview/功能步骤流程.md`                                   | 按用户操作→状态／数据流转说明 Simple、Auto、Agentic、RAG、Bad Case、多 Agent、观测和运营链路                         | 面试官要求具体讲一次请求如何经过页面、服务端、数据库和后台时     |
| `ROADMAP.md`                                                       | 项目真实进度源：已完成、阻塞、最近验证                                                                            | 回答“当前真实状态”和“验证证据”时                                    |
| `docs/plans/remaining-enhancement-plan.md`                         | 一线大厂生产化差距：真实数据、权限、压测、安全、运维                                                              | 讲生产化差距和下一步计划时                                          |

## 推荐阅读顺序

### 0. 高级 Agent 开发面试前 10 分钟

只看：

```text
docs/interview/SEVEN_DIFFICULTIES_INTERVIEW_GUIDE.md 的“30 秒版本”“2 分钟版本”和七项“面试口述版”
INTERVIEW_PLAYBOOK.md
```

重点定位：

```text
面试先看：核心问题清晰回答版
高级 Agent 开发最后速背页
面试时最好主动承认的边界
```

你要记住的不是全文，而是这 5 句话：

```text
1. 这个项目不是简单 Chatbot，而是 Agentic RAG 知识协同平台。
2. 高级 Agent 开发不是让模型自由发挥，而是 Model + Harness。
3. 普通问题走 simple fast path，复杂问题才走 agentic。
4. 答案必须有证据、引用、拒答和评测回归。
5. 本地工程闭环不等于真实生产 SLA，真实数据和生产合规要诚实说边界。
```

### 0.5 高级 Agent 开发系统复习 2 小时

按顺序看：

```text
AI_AGENT_CORE_KNOWLEDGE.md
INTERVIEW_PLAYBOOK.md
docs/interview/agentguide-rag-interview-mapping.md
```

阅读方法：

| 步骤 | 文件                                                 | 怎么看                                             |
| ---- | ---------------------------------------------------- | -------------------------------------------------- |
| 1    | `AI_AGENT_CORE_KNOWLEDGE.md`                         | 看每个知识点的“人话理解 -> 面试怎么说 -> 项目对应” |
| 2    | `INTERVIEW_PLAYBOOK.md`                              | 把长知识压缩成现场回答                             |
| 3    | `docs/interview/agentguide-rag-interview-mapping.md` | 检查 AgentGuide 高频点是否能和项目对上             |

必须说顺的 12 条主线：

```text
RAG 主链路
Chunking / Embedding / Hybrid Search / Rerank
Agentic RAG 和 Deep Research 边界
Agent Harness 七层
Evaluation Harness
Memory 四类
Tool Calling / MCP / Skill
Agent 框架选型
合规型 Agent
沙箱安全
多模态证据定位
数据合成与工作流落地
```

### 1. 投递岗位前

先读：

```text
docs/interview/resume/resume-rag-project.md
docs/interview/resume/resume-rag-project-game-marketing.md
docs/interview/resume/game-marketing-rag-evidence.md
docs/interview/jd/jd-requirements-project-mapping.md
docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md
```

重点看：

- `简历最终版`
- `游戏活动/官网营销专项评测集`
- `量化指标`
- `公司 / 行业要求对照`
- `JD 要求与项目实现一一对照`
- `按岗位类型怎么讲`

目的：

```text
判断这个岗位要什么，项目哪些能力能对上，哪些不要硬说。
```

### 2. 面试前 30 分钟

按顺序读：

```text
INTERVIEW_PLAYBOOK.md
AI_AGENT_CORE_KNOWLEDGE.md
docs/interview/jd/jd-requirements-project-mapping.md
docs/interview/jd/jd-gap-implementation-status.md
```

重点：

- 先用 `INTERVIEW_PLAYBOOK.md` 找临场回答。
- 再用 `AI_AGENT_CORE_KNOWLEDGE.md` 补方案对比和为什么这么选。
- 再用 `jd-requirements-project-mapping.md` 找岗位匹配点。
- 最后用 `jd-gap-implementation-status.md` 确认哪些只能说“基础版”。

### 2.5 面试官按 AgentGuide 深挖时

读：

```text
docs/interview/agentguide-rag-interview-mapping.md
AI_AGENT_CORE_KNOWLEDGE.md
```

使用方式：

| 追问方向                                      | 优先看哪里                                                      |
| --------------------------------------------- | --------------------------------------------------------------- |
| RAG / Chunk / Embedding / Hybrid / Rerank     | `AI_AGENT_CORE_KNOWLEDGE.md` 的 RAG 章节                        |
| Agentic RAG / Deep Research / Self-RAG / CRAG | `AI_AGENT_CORE_KNOWLEDGE.md` 的高级 Agent 章节                  |
| Agent Harness / Evaluation Harness            | `AI_AGENT_CORE_KNOWLEDGE.md` 的 Harness 章节                    |
| AgentGuide 问题如何映射项目                   | `docs/interview/agentguide-rag-interview-mapping.md` 的覆盖矩阵 |
| 哪些不能硬说                                  | `docs/interview/agentguide-rag-interview-mapping.md` 的项目边界 |

### 3. 面试官问“项目现在到底完成到什么程度”

读：

```text
ROADMAP.md
```

回答时只说 ROADMAP 里已经实现并验证过的内容。

### 3.5 面试官问“你参考过哪些开源项目，具体吸收了什么”

先读：

```text
docs/interview/开源项目参考能力归档.md
docs/interview/功能步骤流程.md 的“Dify／RAGFlow／AutoGPT／MetaGPT／CrewAI／AutoGen”章节
ROADMAP.md
```

回答顺序：

```text
1. 先说没有把多个框架直接堆进项目，执行引擎仍是 LangGraph。
2. 再按问题域回答：Dify 管治理，RAGFlow 管知识检索，AutoGPT 管运行中心，MetaGPT 管角色协作，CrewAI 管 Task／Process，AutoGen 管事件和工具协作。
3. 最后落到当前项目的真实入口、数据表和验证结果。
4. 主动区分“本地已实现”和“生产仍需接入”，不要把开源项目的宣传能力当成自己的生产数据。
```

如果继续追问“为什么不直接使用这些框架”，重点说明：当前项目已有 NestJS、LangGraph、Redis Checkpointer、MCP、Milvus、ES／BM25、Neo4j 和 Agent Ops；直接叠加多个 Runtime 会造成状态、权限、工具和观测重复，因此只吸收可迁移的设计思想，统一落到现有技术边界内。

不要把 `INTERVIEW_PLAYBOOK.md` 里的面试表达当作真实进度源。

### 4. 面试官问“一线大厂还差什么”

读：

```text
docs/interview/jd/jd-gap-implementation-status.md
docs/plans/remaining-enhancement-plan.md
```

回答结构：

```text
主干能力已实现：RAG、Agentic Workflow、Tool Calling、Memory、Eval、Observability。
本地基础版已补：Prompt Injection、Prompt Registry、Tool Registry、Agent 任务评测脚手架。
生产级仍缺：真实数据、真实业务 API、IAM/DLP、生产 SLA、灰度、成本预算、真实多模态模型。
```

## 面试时怎么快速定位

| 面试问题                                           | 查哪个文件                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 高级 Agent 开发通用知识怎么复习？                  | `AI_AGENT_CORE_KNOWLEDGE.md`                                                                                          |
| 面试现场怎么说得短？                               | `INTERVIEW_PLAYBOOK.md`                                                                                               |
| AgentGuide 问到的内容有没有覆盖？                  | `docs/interview/agentguide-rag-interview-mapping.md`                                                                  |
| RAG 项目怎么写到简历上？                           | `docs/interview/resume/resume-rag-project.md`                                                                         |
| 怎么把项目贴合游戏活动/营销/官网经历？             | `docs/interview/resume/resume-rag-project-game-marketing.md` + `docs/interview/resume/game-marketing-rag-evidence.md` |
| 简历里 RAG 负责内容和重难点怎么短回答？            | `docs/interview/resume/resume-rag-project-game-marketing.md` 的“简历四条负责内容怎么说”和“重难点与结果短回答”         |
| 你这个项目和阿里/腾讯/百度/字节/美团 JD 对得上吗？ | `docs/interview/jd/jd-requirements-project-mapping.md`                                                                |
| 你项目里哪些没实现？                               | `docs/interview/jd/jd-gap-implementation-status.md`                                                                   |
| RAG 怎么做？                                       | `INTERVIEW_PLAYBOOK.md` 的“面试先看：核心问题清晰回答版”                                                              |
| Agent Harness 怎么讲？                             | `AI_AGENT_CORE_KNOWLEDGE.md` 的“Agent Harness 怎么设计？” + `INTERVIEW_PLAYBOOK.md` 的“高级 Agent 开发最后速背页”     |
| Evaluation Harness 怎么讲？                        | `AI_AGENT_CORE_KNOWLEDGE.md` 的“Agent Evaluation Harness 怎么讲？”                                                    |
| 框架选型怎么讲？                                   | `AI_AGENT_CORE_KNOWLEDGE.md` 的“Agent 框架怎么选？”                                                                   |
| 合规型 Agent 怎么讲？                              | `AI_AGENT_CORE_KNOWLEDGE.md` 的“Parlant / 合规型 Agent 怎么讲？”                                                      |
| 沙箱怎么讲？                                       | `AI_AGENT_CORE_KNOWLEDGE.md` 的“Agent 沙箱怎么讲？”                                                                   |
| 数据合成 / 评测集构建怎么讲？                      | `AI_AGENT_CORE_KNOWLEDGE.md` 的“数据合成 / 评测集构建怎么讲？”                                                        |
| 企业 Agent 落地为什么工作流优先？                  | `AI_AGENT_CORE_KNOWLEDGE.md` 的“企业 Agent 落地：为什么工作流优先？”                                                  |
| Agent 怎么协调？                                   | `INTERVIEW_PLAYBOOK.md` 的“多 Agent 怎么协调” + `docs/interview/jd/jd-requirements-project-mapping.md`                |
| 工具怎么调用？                                     | `INTERVIEW_PLAYBOOK.md` 的“工具怎么调用” + `docs/interview/jd/jd-gap-implementation-status.md`                        |
| Prompt Injection 怎么防？                          | `docs/interview/jd/jd-gap-implementation-status.md`                                                                   |
| Prompt 怎么管理版本？                              | `docs/interview/jd/jd-gap-implementation-status.md`                                                                   |
| Agent 成功率怎么评估？                             | `docs/interview/jd/jd-gap-implementation-status.md`                                                                   |
| ProcessOn「AI 应用」思维导图怎么用？               | `docs/interview/processon-ai-application-mindmap.md` + 本文档的“ProcessOn AI 应用思维导图用法”                        |
| 金融/证券生产还差什么？                            | `docs/plans/remaining-enhancement-plan.md`                                                                            |
| 当前最新进度和验证命令是什么？                     | `ROADMAP.md`                                                                                                          |
| 资深架构岗／Staff 还差什么，真实数据怎么补？       | `docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md`                                                                  |

## 不能混用的地方

- `ROADMAP.md` 是真实进度源。
- `AI_AGENT_CORE_KNOWLEDGE.md` 是知识理解源，不是简历可复制稿。
- `docs/interview/agentguide-rag-interview-mapping.md` 是 AgentGuide 对照和边界源，不是项目完成度承诺。
- `docs/interview/resume/resume-rag-project.md` 是简历表达源，写简历优先复制它。
- `docs/interview/resume/resume-rag-project-game-marketing.md` 是更贴合主人经历的业务版简历表达。
- `docs/interview/resume/game-marketing-rag-evidence.md` 是业务证据源，说明为什么这个项目不是泛泛 RAG demo。
- `INTERVIEW_PLAYBOOK.md` 是表达话术，不是进度源。
- `docs/interview/jd/jd-requirements-project-mapping.md` 是 JD 对照，不是承诺所有 JD 能力都已完成。
- `docs/interview/jd/jd-gap-implementation-status.md` 是缺口状态，不要把“基础版已实现”说成“生产平台已完成”。
- `docs/interview/开源项目参考能力归档.md` 是开源项目对照和融合记录，不是这些开源项目的所有能力都已在当前项目生产化。
- `docs/interview/功能步骤流程.md` 是用户操作和服务端状态流转说明；需要讲“怎么用、数据怎么走”时优先看它，不要只背参考项目名称。
- `docs/plans/remaining-enhancement-plan.md` 里的真实生产/真实数据/真实合规项，不能靠本地模拟冒充完成。
- `docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md` 是岗位证据和操作手册；其中自动生成的本地报告也不能冒充真实生产经历。

## 不同时间预算怎么用

| 时间    | 只做什么                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| 5 分钟  | 读 `INTERVIEW_PLAYBOOK.md` 的“一句话定位”和“高级 Agent 开发最后速背页”               |
| 10 分钟 | 加看“面试先看：核心问题清晰回答版”                                                   |
| 30 分钟 | 再看“面试时最好主动承认的边界”和 `docs/interview/jd/jd-gap-implementation-status.md` |
| 2 小时  | 系统读 `AI_AGENT_CORE_KNOWLEDGE.md`，把每个方案的优缺点说顺                          |
| 半天    | 对照 `docs/interview/agentguide-rag-interview-mapping.md` 和目标 JD，做公司定制回答  |

## 面试回答组装公式

每个问题都按这个结构回答：

```text
一句话结论 -> 候选方案 -> 我怎么选 -> 项目怎么做 -> 怎么验证 -> 边界是什么
```

例子：

```text
面试官问“为什么用 LangGraph？”

一句话结论：生产级 Agent 要可控，不只是灵活。
候选方案：Chain、ReAct、LangGraph/FSM、AutoGen、CrewAI。
我怎么选：普通链路用 Chain，复杂 Agentic RAG 用 LangGraph。
项目怎么做：routing、retrieval、sufficiency、rerank、generate、reflection 拆成节点。
怎么验证：通过评测集、trace、SSE 事件和失败样本回归定位问题。
边界：这不是完全自治 Agent，也不是 A2A 平台。
```

## ProcessOn AI 应用思维导图用法

原图链接：

```text
https://www.processon.com/view/link/6a66ce9ad35afd24c9ee7c62
```

这张图更适合当作「AI 应用 / Agent 面试知识地图」，不要当作简历项目逐条背。它的价值是帮你检查：面试官追问 RAG、Agent、Memory、Workflow、MCP、Skill、工程落地时，哪些问题你能接住，哪些只是补课方向。

### 图里当前能看到的核心内容

```text
主题：大模型与 Agent 技术全景知识库

三、Agent 系统设计

1. Agent 记忆机制
   - Agent 的记忆污染怎么办？
   - 记忆系统上线后如何证明不是越记越乱？
   - Agent 是如何做记忆管理的？

2. Agent 架构与工作流
   - Agent 的 7 种主流架构全解析
   - 设计生产级 Agent 系统的六层架构
   - Agent 和 Workflow 的核心差异？
   - LangChain 和 LangGraph 有何区别？
   - LangGraph 里的节点、边、状态解决什么问题？
   - Loop vs Graph：从单线闭环到全局编排
   - Claude Code 的架构原理与传统 Agent 的差异

3. Agent 工程落地
   - 开发一个 Agent 流程是怎样的？
   - 从零搭建第一个 AI Agent

4. Agent 技能与工具
   - Agent Skill 和 MCP 的本质区别
   - Agent 技能中 ReAct 模式最核心技术要点
   - Skill 数量一多，Agent 的命中率怎么保证？
   - Skill 上线之后如何持续维护？
   - AI 生成的 Skill 上线前如何证明质量过关？
```

### 和你的 RAG 项目怎么对上

| 图里的方向             | 你的项目怎么讲                                                          | 面试重点                                          |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Agent 记忆机制         | Redis 短期记忆摘要 + Mem0 长期记忆 + Admin 记忆管理                     | 记忆分层、污染控制、摘要压缩、用户隔离            |
| Agent 架构与工作流     | simple / auto / agentic 分层路由，复杂需求走 LangGraph                  | 简单问题 fast path，复杂问题 Agentic Workflow     |
| LangGraph 节点/边/状态 | routing、retrieval、sufficiency、rerank、generate、citation、reflection | 为什么用图编排，而不是单次 LLM 调用               |
| Agent 工程落地         | RAG 后端、Admin、评测脚本、MCP 工具服务                                 | 能运营、能评测、能被 AI Coding 工具调用           |
| Skill 和 MCP           | Skill 更像本地能力/流程封装，MCP 是 Agent 调外部系统的标准工具接口      | CLI 给脚本和批量任务用，MCP 给 Agent 自动取上下文 |
| Skill 命中率/维护      | Prompt Registry、Tool Registry、评测集回归、工具描述收敛                | 工具不是越多越好，要有路由、描述、评测和维护机制  |

### AI 应用面试知识树补全版

下面这部分不是从 ProcessOn 页面源码直接抽出的完整节点，而是结合这张图的方向，按 AI 应用 / Agent / RAG 面试会追问的内容补齐。面试复习时优先看这版。

#### 1. 大模型调用与基础能力

```text
核心问题：
- 模型怎么选？
- temperature、top_p、max_tokens 怎么调？
- 流式输出怎么做？
- JSON / 结构化输出怎么保证稳定？
- 多模型兜底怎么做？

你的项目回答：
- 普通问答走 DeepSeek / OpenAI 兼容模型。
- Admin 问答侧支持 SSE / AG-UI 事件流，避免一次性返回导致体验差。
- 复杂任务不是只靠一次 prompt，而是拆成 routing、retrieval、generation、citation、reflection 等节点。
- 结构化方案类输出通过固定模板、引用校验和后置检查降低格式漂移。
```

#### 2. Prompt 工程与 Prompt 管理

```text
核心问题：
- Prompt 怎么设计？
- Prompt 怎么版本管理？
- Prompt Injection 怎么防？
- System Prompt 和用户输入怎么隔离？
- 不同业务场景怎么复用 Prompt？

你的项目回答：
- 有 Prompt Registry 基础版，用来集中维护 prompt。
- 检索片段当成不可信证据，不允许覆盖系统规则。
- 对 prompt injection 做规则检测和评测集回归。
- 游戏活动方案、埋点方案、地区适配、上线检查等场景用不同模板收敛输出结构。
```

#### 3. 知识入库与数据治理

```text
核心问题：
- 文档怎么解析？
- Chunk 怎么切？
- URL、PDF、DOCX、网页、Obsidian 怎么统一入库？
- 文档更新后索引怎么保持一致？
- 权限和租户隔离怎么做？

你的项目回答：
- 支持 PDF / DOCX / Markdown / URL / HTML / Obsidian 笔记等多来源入库。
- 入库后进入 RAG 索引层，同时和 Karpathy + Obsidian 编译层互补。
- Chunk 不只按长度切，还保留标题、来源、元数据、引用信息。
- 多租户 userId 隔离，权限相关问题不能跨用户召回。
```

#### 4. RAG 检索与召回优化

```text
核心问题：
- 为什么不用纯向量？
- BM25、ES、向量召回分别解决什么？
- RRF 是什么？
- Rerank 放在哪里？
- 召回不准怎么优化？

你的项目回答：
- 简单问题走 Karpathy + Obsidian fast path，先保证低延迟和低成本。
- 复杂问题走 Hybrid Search，Milvus 负责语义相似，BM25/ES 负责精确词和业务术语，RRF 做融合。
- Rerank 放在召回之后、生成之前，用来过滤噪声和提升证据排序。
- 如果低相关或证据不足，走拒答、补检索或人工确认，而不是硬生成。
```

#### 5. GraphRAG 与关系补全

```text
核心问题：
- GraphRAG 解决什么问题？
- 图谱实体和关系怎么设计？
- 它和向量检索是什么关系？
- 图谱数据怎么更新？

你的项目回答：
- 向量检索找相似内容，GraphRAG 补关系。
- 游戏活动里活动类型、玩法、页面模块、接口、埋点、地区版本、风险项之间有强关系。
- 图谱不是替代 RAG，而是在方案生成时补齐遗漏项。
- 当前有 schema、实体、关系、别名规则和 GraphOps 管理能力；真实图谱后续可替换模拟数据源。
```

#### 6. Agentic Workflow 与多 Agent

```text
核心问题：
- Agent 和 Workflow 有什么区别？
- 为什么用 LangGraph？
- 多 Agent 怎么协同？
- 怎么避免 Agent 跑偏？
- researcher / analyst / writer / critic / editor 分别干什么？

你的项目回答：
- 简单问题不用 Agent，复杂需求才进入 Agentic Workflow。
- LangGraph 用节点、边、状态表达可分支、可回退、可检查的流程。
- researcher 负责查资料，analyst 负责分析结构和风险，writer 负责生成方案，critic 负责挑问题，editor 负责整理成最终输出。
- Supervisor 根据领域和任务复杂度选择 Agent 子集，不是所有问题都全量跑。
```

#### 7. Memory、缓存与 Token 节省

```text
核心问题：
- 记忆怎么分层？
- 记忆污染怎么办？
- 缓存什么？
- Token 太长怎么办？
- 多轮对话上下文怎么压缩？

你的项目回答：
- Redis 做短期会话记忆，保留最近窗口并做摘要压缩。
- Mem0 做长期记忆，用来沉淀稳定偏好和事实。
- 记忆写入前要分类，避免把临时错误结论写成长期记忆。
- 检索 topK、Rerank、摘要、引用片段裁剪共同控制 token。
- simple fast path 本身也是降成本和降延迟手段。
```

#### 8. 工具调用、MCP 与 AI Coding

```text
核心问题：
- Tool Calling 怎么设计？
- MCP 什么时候调用？
- CLI 和 MCP 有什么区别？
- Codex / Claude Code 怎么拿内部上下文？
- 工具太多怎么保证命中率？

你的项目回答：
- CLI 面向人、脚本、批量导入和批量评测。
- MCP 面向 Agent，让 Codex / Claude Code / Trae 自动调用 RAG 能力。
- rag_search 查资料，rag_context 拿上下文，rag_game_plan 生成活动技术方案，rag_agent_pipeline 调多 Agent 管线。
- Tool Registry 维护工具描述和边界，评测集检查工具命中和输出质量。
```

#### 9. 可信输出、纠错与评测

```text
核心问题：
- 怎么降低幻觉？
- 怎么保证引用可信？
- 什么时候拒答？
- RAG 准确率怎么评估？
- 线上问题怎么回归？

你的项目回答：
- 生成前做 sufficiency gate 和 Rerank，生成后做 citation gate。
- 证据不足、相关性低、权限不匹配、疑似 prompt injection 时拒答或提示人工确认。
- 评测指标包括 Recall、MRR、Faithfulness、Answer Relevancy。
- 游戏业务专项评测看玩法识别、页面模块覆盖、接口/埋点覆盖、风险项召回、地区适配和拒答正确率。
```

#### 10. 安全、权限与合规边界

```text
核心问题：
- 私有知识库怎么防越权？
- Prompt Injection 怎么防？
- 敏感信息怎么处理？
- 金融 / 证券 / 大厂生产环境还差什么？

你的项目回答：
- 当前有多租户隔离、权限过滤、审计日志、Prompt Injection 基础防护。
- 外部网页和用户上传内容都当不可信输入处理。
- 不能把本地模拟数据说成真实生产数据。
- 金融级生产还需要真实 IAM、DLP、审计留痕、SLA、灰度、成本预算和安全合规接入。
```

#### 11. 可观测、性能与生产化

```text
核心问题：
- 慢在哪里怎么定位？
- 怎么做流式体验？
- 怎么做异步入库？
- 怎么压测？
- 怎么监控成本和质量？

你的项目回答：
- 问答链路有 SSE / AG-UI 事件流，前端可以边生成边显示。
- 文档入库有 BullMQ 异步队列，Redis 不可用时降级同步。
- Prometheus / traceparent / LangFuse provider 用来做调用、延迟、链路和质量观测。
- 本地已有 smoke 和评测脚手架；真实生产压测、SLA、成本预算仍要等真实环境。
```

#### 12. 面向业务的 AI 应用价值

```text
核心问题：
- 这个项目不是 demo 的价值在哪里？
- 谁用？
- 解决什么业务问题？
- 为什么贴合你的游戏活动 / 官网经历？

你的项目回答：
- 主要给业务负责人、产品、UI、测试、前端使用。
- 不是替运营拍板活动规则，而是把活动想法转成可评审、可开发、可验收的方案。
- 对游戏活动 / 官网业务来说，稳定沉淀的是玩法类型、页面模块、接口模式、埋点规范、地区适配和上线 checklist。
- 价值是减少理解成本、减少方案遗漏、帮助 AI Coding 工具拿到内部上下文后再写代码。
```

### 高频追问速查

| 面试追问                   | 一句话回答                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| 为什么不用纯向量？         | 纯向量能找相似，但业务术语、精确规则和关系依赖容易漏，所以用 Hybrid Search + GraphRAG。    |
| simple 模式解决什么？      | 解决简单知识查询的延迟和成本问题，先走 Karpathy + Obsidian fast path。                     |
| 什么时候走 Agentic？       | 只有复杂需求、证据不足、需要拆方案和补风险时才走 Agentic。                                 |
| GraphRAG 有什么用？        | 用来补齐活动玩法、页面、接口、埋点、地区版本、风险项之间的关系。                           |
| 记忆污染怎么办？           | 写入前分类，短期和长期分层，长期只沉淀稳定事实，错误和临时上下文不固化。                   |
| Token 怎么省？             | fast path、topK 控制、Rerank、摘要压缩、片段裁剪、低相关拒答一起做。                       |
| 工具怎么调用？             | MCP 暴露标准工具，Agent 根据工具描述和任务上下文选择调用。                                 |
| MCP 和 CLI 区别？          | CLI 给人和脚本用，MCP 给 Agent 自动调用。                                                  |
| 幻觉怎么控？               | sufficiency gate、Rerank、citation gate、低相关拒答、Prompt Injection 检测、评测回归。     |
| 怎么证明有效？             | 通用 RAG 指标 + 游戏活动专项指标 + 失败样本回流评测集。                                    |
| 生产还差什么？             | 真实数据、真实权限系统、真实多模态模型、生产 SLA、灰度、成本和合规。                       |
| 这个项目和前端有什么关系？ | 它把活动需求转成页面结构、接口、埋点、风险和验收清单，并通过 MCP 给 AI Coding 提供上下文。 |

### 面试时不要展开成大而全

如果面试官问「你这个项目的 Agent 怎么设计」，不要从图里的所有概念开始讲。直接按你的项目主线回答：

```text
我没有把所有问题都做成复杂 Agent，而是做了分层路由。
简单知识查询走 Karpathy + Obsidian fast path，保证低延迟和低成本。
复杂活动需求再走 LangGraph Agentic Workflow，把需求拆成页面结构、接口清单、埋点方案、风险检查和验收 checklist。
```

如果追问「为什么不是普通 Workflow」，再补：

```text
普通 Workflow 适合固定步骤，但复杂活动需求里，经常会出现证据不足、需要补检索、需要补图谱关系、需要拒答或人工确认的情况。
LangGraph 的节点、边和状态更适合做这种可回退、可分支、可检查的编排。
```

如果追问「记忆怎么做」，回答：

```text
短期记忆放 Redis，按会话滑动窗口保留最近对话，并做摘要压缩，避免 token 越滚越大。
长期记忆走 Mem0，用来沉淀用户偏好、历史问题和稳定事实。
记忆写入前要分类，检索时按用户和会话隔离，避免把临时错误结论写成长期事实。
```

如果追问「MCP 和 Skill 有什么区别」，回答：

```text
Skill 更像 Agent 本地的能力说明和流程封装，适合告诉 Agent 怎么做某类任务。
MCP 是标准工具接口，适合让 Codex、Claude Code、Trae 这类 Agent 去调用外部 RAG 系统。
所以我的项目里 CLI 给脚本和批量任务用，MCP 给 Agent 自动检索业务规则、组件规范和方案上下文。
```

### 这张图对你的补课优先级

```text
P0：RAG 主链路、Hybrid Search、GraphRAG、Agentic Workflow、MCP、Memory、Eval。
P1：Agent 架构差异、LangGraph 节点/边/状态、Skill/MCP/Tool Calling 区别。
P2：生产级 Agent 六层架构、Skill 命中率维护、记忆污染评估。
P3：Claude Code 架构原理、主流 Agent 架构大全。
```

一句话定位：

```text
这张图是补课地图，不是简历稿；面试回答还是围绕你的 RAG 项目主线：知识入库、分层检索、GraphRAG、Agentic Workflow、可信输出、MCP 赋能 AI Coding。
```

## 面试前 5 分钟速记

```text
1. 主干对得上：RAG、Agentic、Tool Calling、Memory、Eval、Observability、Admin Ops。
2. 本地已补：Prompt Injection 基础防护、Prompt Registry、Tool Registry、Agent 任务评测脚手架、游戏活动/官网营销专项评测 96 条。
3. 生产仍缺：真实业务 API、真实组织权限、真实多模态、金融合规、SLA、灰度、成本预算。
4. 不能吹：A2A、SFT/RLHF、金融生产合规、完整多模态理解、生产级高可用。
```
