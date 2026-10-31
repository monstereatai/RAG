# 项目文档

文档按“业务是什么 → 上下文怎么构建 → Agent 如何运行 → 系统如何部署和治理”的顺序组织。当前状态和最近验证只维护在根目录 `ROADMAP.md`，Git 历史承担长期变更追溯。

## 分层阅读

| 层级 | 文档 | 回答的问题 |
| --- | --- | --- |
| 项目认知 | [项目背景](PROJECT_BACKGROUND.md) | 服务谁、解决什么、边界是什么？ |
| 上下文构建 | [项目上下文工程](CONTEXT_ENGINEERING.md) | 提示词、记忆、RAG、工具和输出如何组成上下文？ |
| Agent 运行时 | [智能体运行时](AGENT_RUNTIME.md) | 如何编排、审批、恢复、评测和治理任务？ |
| 系统架构 | [系统架构](architecture/ARCHITECTURE.md) | 服务、模块、数据和核心链路如何连接？ |
| 运行与治理 | [项目运行、安全与交付](OPERATIONS.md) | 如何启动、检查、安全运行和理解外部缺口？ |

## 细节入口

- [功能步骤流程](interview/功能步骤流程.md)：真实用户请求、知识入库、问答模式和工作流的步骤图。
- [AI Agent 面试与 JD 对照 RAG 项目差距清单](interview/ai-agent-interview-rag-gap-analysis.md)：按 T00–T43 和 J01–J14 对照仓库实现，区分代码优化、真实数据/目标环境验收和非项目范围。
- 四窗口并行执行任务单（共享工作树时按文件范围协作）：
  - [窗口 1：Agent、模型与工具](interview/ai-agent-rag-window-1-agent-model-tools.md)
  - [窗口 1：面试证据与模型对比手册](interview/ai-agent-rag-window-1-evidence-and-model-comparison.md)
  - [窗口 2：记忆、知识入库与 RAG](interview/ai-agent-rag-window-2-memory-retrieval-data.md)
  - [窗口 3：评测、可观测与运行可靠性](interview/ai-agent-rag-window-3-evaluation-reliability.md)
  - [窗口 4：Sandbox、安全、产品化与 JD](interview/ai-agent-rag-window-4-sandbox-product-jd.md)
- [上下文工程指南逐篇对照](reference/CONTEXT_ENGINEERING_GUIDE_AUDIT.md)：按固定 GitHub 提交逐篇核对 43 篇参考文章、当前实现和适用差距。
- [Playway 组件清单](reference/playway-component-inventory.md)：项目业务模块使用的组件名称与组合信息。
- [RAG CLI 与主项目的关系](cli-docs/README.md)：说明 CLI 在系统中的职责、边界，并链接到包内产品、架构、使用和进度文档。
- [RAG 检索模块说明](../apps/rag-api/src/rag/retrieval/README.md)：检索实现的源码邻近说明。

## 维护规则

- 同一主题只保留一个当前主文档；计划落地后由架构、Runtime、Operations 和 ROADMAP 收敛，不继续维护重复计划、ADR 索引或验证报告。
- 文档只记录当前项目知识；时序进度、验证结果和阻塞写入 ROADMAP，历史细节通过 Git 查找。
- 流程图保留在功能步骤流程中，系统架构图保留在架构文档中；未被项目实际使用的课程、面试、通用资料和重复附件不放在此目录。
- 新增目录前先明确用途、归档边界和清理方式；源码字段和运行契约以实现及自动生成契约为准。
