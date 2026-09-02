# Docs Index

> 本目录只放项目补充文档。项目入口、当前进度和规则仍以根目录 `README.md`、`ROADMAP.md`、`CLAUDE.md` 为准。

## 目录结构

| 目录                      | 用途                                     |
| ------------------------- | ---------------------------------------- |
| `interview/`              | AI 应用开发 / 高级 Agent 开发面试材料    |
| `interview/resume/`       | 简历写法、业务证据、游戏营销项目表达     |
| `interview/jd/`           | JD 要求、项目能力映射和缺口状态          |
| `plans/`                  | 工程方案、增强计划、同步策略             |
| `architecture/`          | 技术架构、服务边界、部署和基础设施       |
| `product/`                | PRD、管理后台功能和产品集成说明         |
| `cli/`                    | RAG CLI 产品和技术设计                  |
| `reference/`              | 参考项目能力总结和学习资料               |
| `archive/`                | 历史 Roadmap 和过期方案归档              |
| `assets/`                 | 文档引用的图片等静态资源                 |
| `architecture-decisions/` | 关键架构选择、代价、指标和回滚条件       |
| `evidence/`               | 真实规模、跨团队和事故证据的本地填写模板 |

## 项目背景

| 文档                    | 用途                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `PROJECT_BACKGROUND.md` | 游戏官网／活动产研一体化 RAG 与 Agent 工作台的业务背景、目标用户、协作流程、方案来源、成功标准和项目边界 |

## 使用指南

| 文档                           | 用途                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `PRODUCTION_WORKFLOW_USAGE.md` | 六岗位单独使用、多岗位协作、审批策略、管理后台操作和 API 示例 |
| `architecture/DOMAIN_EVENT_OUTBOX_USAGE.md` | 内部 Hook、领域事件 Outbox、企业微信／Webhook 订阅、重试与安全边界 |

## 面试材料

| 文档                                                          | 用途                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `interview/README.md`                                         | 面试文档总入口：最短阅读路线、主题导航、全文件说明和四类岗位复习顺序                            |
| `interview/interview-docs-usage.md`                           | 面试文档使用说明和阅读顺序                                                                      |
| `interview/AI_TOOLING_INTERVIEW_GUIDE.md`                     | Agent、多 Agent、Function Calling、Tool、MCP Server、Skill 的解释、伪代码、业务场景、设计和评测 |
| `interview/AGENT_ARCHITECTURE_SELECTION_GUIDE.md`             | Agent 平台总架构图、十一类单／多 Agent 方案、优缺点、业务场景、决策树和项目选型                 |
| `interview/USER_ARCHITECTURE_INTERVIEW_QUESTION_INVENTORY.md` | 主人问过的 RAG、Agent、多 Agent、Tool／MCP／Skill、架构与岗位问题总清单，以及待补问题           |
| `interview/SEVEN_DIFFICULTIES_INTERVIEW_GUIDE.md`             | 七项 Agent／RAG 核心难点的背景、方案对比、实现效果、口述稿、追问答案和项目代码地图              |
| `interview/SENIOR_AGENT_INTERVIEW_READINESS.md`               | 高级／资深／Staff 岗位判断、真实业务补数、稳定性回放、架构决策、故障与跨团队证据操作手册        |
| `interview/agentguide-rag-interview-mapping.md`               | AgentGuide 高频知识与项目能力对照                                                               |
| `interview/processon-ai-application-mindmap.md`               | ProcessOn「AI 应用」知识图谱整理                                                                |
| `interview/resume/resume-rag-project.md`                      | RAG 项目简历写法                                                                                |
| `interview/resume/resume-rag-project-game-marketing.md`       | 游戏官网营销 RAG 项目简历写法                                                                   |
| `interview/resume/game-marketing-rag-evidence.md`             | 游戏活动 / 官网营销 RAG 证据说明                                                                |
| `interview/resume/deepseek-高级资深Agent全栈简历定位与面试口径.md` | 高级资深 AI Agent 全栈 / AI 应用开发简历项目定位、三主线 STAR 口径与面试攻防清单                  |
| `interview/jd/jd-requirements-project-mapping.md`             | 一线大厂 AI 应用 / Agent JD 与项目实现对照                                                      |
| `interview/jd/jd-gap-implementation-status.md`                | JD 差距本地补齐状态                                                                             |

## 工程方案

| 文档                                                | 用途                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `plans/remaining-enhancement-plan.md`               | 剩余增强项和生产化差距                                                                    |
| `plans/game-production-rag-functional-plan.md`      | 游戏官网／活动场景的入库、检索、上下文、业务元数据、生命周期、Bad Case 和专项评测增强方案 |
| `plans/expert-agent-difficulties-implementation.md` | 七项专家级 Agent／RAG 难点的实现入口、方案取舍、指标和真实验证                            |
| `plans/karpathy-obsidian-dual-ingest-plan.md`       | Karpathy + Obsidian 统一知识链路方案                                                      |
| `plans/游戏运营营销公开资料与Karpathy方案.md`       | PC／页游 Top100 公开资料抓取、入库、Simple Karpathy Fast Path 和最终验收口径                  |
| `plans/official-docs-sync.md`                       | 官方文档夜间同步策略                                                                      |
| `architecture-decisions/README.md`                  | Workflow First、混合检索、证据门禁、分层记忆和降级恢复五项 ADR 索引                       |
| `evidence/EVIDENCE_COLLECTION_TEMPLATES.md`         | 跨团队交付、事故复盘和架构决策口述模板                                                    |

## 参考资料

| 文档 | 用途 |
| --- | --- |
| `reference/SUMMARY.md` | 本仓库课程参考代码能力总览 |
| `reference/企业级知识库课程与v1-v9对照优化建议.md` | 对照 11 份课程 PDF、knowledge-hub-backend v1～v9 与当前项目，区分已有能力、真实缺口、推荐优化和不建议照搬项 |

## 文档治理补强

文档管理已补齐统一 ACL 检索过滤、独立审核状态机、PPTX 结构化解析降级、ES 命中片段高亮和 BullMQ 失败任务幂等重放。数据迁移文件已生成，执行仍需由部署环境按迁移流程完成。

## 维护规则

- 根目录只保留 `README.md`、`CLAUDE.md`、`ROADMAP.md`、版本和工程配置；新增项目文档不要继续堆在根目录。
- 源码服务目录保持现有边界：`backend/`、`admin/`、`admin-backend/`、`frontend/` 不因文档整理而改名或搬迁。
- 新增面试相关材料优先放入 `interview/`。
- 新增简历或业务证据材料放入 `interview/resume/`。
- 新增 JD 对照、岗位缺口材料放入 `interview/jd/`。
- 新增工程方案、规划、策略说明放入 `plans/`。
- 新增图片等附件放入 `assets/`，并使用相对路径引用。
- 运行时文件放入 `workspace/`、`uploads/` 或服务自己的临时目录，不放入 `docs/`，也不提交索引、缓存和用户上传内容。
