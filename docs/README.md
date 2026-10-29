# Docs Index

> 项目入口、当前进度和规则仍以根目录 `README.md`、`ROADMAP.md`、`CLAUDE.md` 为准。本目录只保留当前可用的补充文档、架构决策、重构证据和面试材料。

## 目录结构

| 目录 | 用途 |
| --- | --- |
| `architecture/` | 当前架构、服务边界、部署、监控、功能边界和就绪度 |
| `architecture-decisions/` | Workflow First、混合检索、证据门禁、分层记忆、超时降级等 ADR |
| `product/` | PRD 和 AG-UI 接入说明 |
| `cli/` | RAG CLI 产品与技术设计 |
| `plans/` | 仍未完成的生产化增强计划和运维策略 |
| `refactor/` | 本轮 RAG 重构的边界、兼容契约、验证证据和迁移记录 |
| `evidence/` | 跨团队交付、事故复盘和架构决策的证据填写模板 |
| `reference/` | 课程代码总览、Playway 组件清单和外部参考矩阵 |
| `interview/` | 面试导航、核心知识、项目证据、JD 与简历材料 |
| `assets/` | 仍被当前文档引用的静态资源 |

## 核心入口

| 文档 | 用途 |
| --- | --- |
| `PROJECT_BACKGROUND.md` | 项目背景、目标用户、业务流程和边界 |
| `API_CONTRACT_GOVERNANCE.md` | API 契约治理原则 |
| `PRODUCTION_WORKFLOW_USAGE.md` | 六岗位协作、审批、管理后台与 API 使用说明 |
| `SECURITY_AND_DATA_LIFECYCLE.md` | 安全、权限和数据生命周期约束 |

## 架构与运行

| 文档 | 用途 |
| --- | --- |
| `architecture/ARCHITECTURE.md` | 系统总架构、模块关系和技术约束 |
| `architecture/RAG_CAPABILITY_BOUNDARIES.md` | RAG 索引、检索、证据、Obsidian 和回答服务的当前边界 |
| `architecture/SERVICE_BOUNDARIES.md` | `rag-backend` 与 `admin-backend` 服务边界 |
| `architecture/AGENT_PLATFORM_READINESS.md` | Agent 平台运行时、审批恢复、评测、可观测性和生产边界 |
| `architecture/DEPLOYMENT.md` | 本地启动与部署入口 |
| `architecture/DEPLOYMENT_CHECKLIST.md` | 生产部署前逐项确认清单 |
| `architecture/MONITORING_PROMETHEUS_GRAFANA.md` | Prometheus、Grafana、告警和记录规则 |
| `architecture/DOCKER_SERVICES_INVENTORY.md` | Docker 服务、端口、数据卷和冲突风险 |
| `architecture/DOMAIN_EVENT_OUTBOX_USAGE.md` | Domain Event Outbox、Hook、重试与安全边界 |
| `architecture/TEAM_WIKI.md` | Team Wiki 页面、修订、来源、回滚和租户边界 |
| `architecture/FEISHU_WIKI_SYNC.md` | 飞书 Wiki 同步、凭据边界和租户共享选项 |
| `architecture-decisions/README.md` | 五项关键 ADR 索引 |

## 产品、CLI 与增强计划

| 文档 | 用途 |
| --- | --- |
| `product/PRD.md` | 产品需求、范围和验收标准 |
| `product/AGUI_INTEGRATION.md` | 用户端与管理后台 AG-UI 流式问答接入 |
| `cli/CLI_PRD.md` | RAG CLI 产品设计 |
| `cli/CLI_ARCHITECTURE.md` | RAG CLI 技术架构 |
| `plans/remaining-enhancement-plan.md` | 尚未完成的生产化差距和外部输入项 |
| `plans/official-docs-sync.md` | 官方文档夜间同步策略 |

## 重构与验证

| 文档 | 用途 |
| --- | --- |
| `refactor/README.md` | 重构证据目录约定 |
| `refactor/progress.md` | 分批重构、验证结果和剩余外部验收 |
| `refactor/00-baseline.md` | 重构前基线 |
| `refactor/01-module-audit.md` | 模块和调用链审计 |
| `refactor/02-target-architecture.md` | 目标依赖和组件边界 |
| `refactor/03-api-and-event-compatibility.md` | API、事件、权限和引用兼容性 |
| `refactor/04-test-and-evaluation.md` | 测试层级和当前证据 |
| `refactor/05-migration-and-rollback.md` | 迁移与回滚边界 |
| `refactor/blocked-validation.md` | 需要真实环境的外部验收 |
| `evidence/EVIDENCE_COLLECTION_TEMPLATES.md` | 跨团队交付、事故复盘和架构决策口述模板 |
| `evidence/real-world-evidence.example.json` | 真实规模、跨团队和事故证据的数据模板 |

## 面试材料

`interview/README.md` 是面试材料的唯一导航入口。当前保留的核心文档：

| 文档 | 用途 |
| --- | --- |
| `interview/AI_AGENT_CORE_KNOWLEDGE.md` | 高级 Agent / RAG 核心知识 |
| `interview/AI_TOOLING_INTERVIEW_GUIDE.md` | Agent、Tool、MCP、Skill 专题 |
| `interview/AGENT_ARCHITECTURE_SELECTION_GUIDE.md` | Agent 架构方案与选型 |
| `interview/USER_ARCHITECTURE_INTERVIEW_QUESTION_INVENTORY.md` | 已问过的架构问题总清单 |
| `interview/SEVEN_DIFFICULTIES_INTERVIEW_GUIDE.md` | 七项 Agent / RAG 技术难点讲解 |
| `interview/SEVEN_DIFFICULTIES_CHEATSHEET.md` | 七个难点的一页式速查 |
| `interview/SENIOR_AGENT_INTERVIEW_READINESS.md` | 高级 / 资深岗位就绪度与证据清单 |
| `interview/agentguide-rag-interview-mapping.md` | AgentGuide 高频知识与项目映射 |
| `interview/processon-ai-application-mindmap.md` | ProcessOn「AI 应用」知识地图整理 |
| `interview/功能步骤流程.md` | 按真实请求链路理解 Simple / Auto / Agentic |
| `interview/3小时AI应用Agent面试突击.md` | 3 小时面试突击路线 |
| `interview/deepseek-AI应用Agent岗-10小时冲刺指南.md` | 10 小时面试冲刺路线 |
| `interview/AI复盘四场面试问题与RAG项目回答-面试表达版.md` | 58 个真实面试问题的表达版 |
| `interview/开源项目参考能力归档.md` | Dify、RAGFlow、Agent 框架参考能力归档 |
| `interview/Agent记忆工具权限Hooks面试速记.md` | Memory、Tool、Permission、Hooks 速记 |
| `interview/Agent-Task-Artifact结构验收与驳回重跑.md` | Chat / Task / Artifact 验收与驳回重跑 |
| `interview/岗位产物验收标准.md` | 岗位产物验收口径 |
| `interview/resume/resume-rag-project.md` | RAG 项目简历写法 |
| `interview/resume/resume-rag-project-game-marketing.md` | 游戏营销 RAG 简历写法 |
| `interview/resume/game-marketing-rag-evidence.md` | 游戏营销 RAG 证据说明 |
| `interview/resume/deepseek-高级资深Agent全栈简历定位与面试口径.md` | 高级资深 Agent 全栈简历定位 |
| `interview/jd/jd-requirements-project-mapping.md` | 一线大厂 JD 与项目能力映射 |
| `interview/jd/jd-gap-implementation-status.md` | JD 差距补齐状态 |
| `interview/jd/BOSS_20K_AI_Agent岗位要求与面试指南.md` | BOSS 20K+ AI Agent 岗位要求 |
| `interview/jd/BOSS_20K_AI_Agent高频面试题库_来源版.md` | BOSS AI Agent 高频题库来源版 |

## 参考资料

| 文档 | 用途 |
| --- | --- |
| `reference/SUMMARY.md` | 本仓库课程参考代码能力总览 |
| `reference/playway-component-inventory.md` | Playway 组件清单 |
| `reference/企业级知识库课程与v1-v9对照优化建议.md` | 企业知识库课程与 v1-v9 对照 |
| `reference/LANGFUSE_OBSERVABILITY_TEST_MATRIX.md` | Langfuse 可观测性测试矩阵 |

## 维护规则

- 根目录只保留 `README.md`、`CLAUDE.md`、`ROADMAP.md`、版本和工程配置；新增项目文档不要继续堆在根目录。
- 同一主题只保留一个主文档；旧方案已被架构、ADR、PRD 或重构记录取代时删除，不继续追加近义文件。
- 新增面试材料优先放入 `interview/`，简历和业务证据放入 `interview/resume/`，JD 对照放入 `interview/jd/`。
- 新增工程方案放入 `plans/`；落地并验证后，只保留仍需要的运维说明，其余由架构文档和证据记录收敛。
- 新增图片放入 `assets/` 并使用相对路径引用；未被任何 Markdown 引用的图片不提交。
- 运行时文件放入 `workspace/`、`uploads/` 或服务自己的临时目录，不放入 `docs/`，也不提交索引、缓存和用户上传内容。
