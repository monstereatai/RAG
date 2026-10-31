# 执行窗口 2：记忆、知识入库与 RAG

本任务单供主人在第 2 个 Codex 窗口执行。它拆分自[当前缺口清单](./ai-agent-rag-missing-and-optimization-checklist.md)，不替代原清单；以原清单和当前源码为准。

## 负责范围

- 项目级 P0 真实业务语料、数据来源、权限和检索质量中属于知识入库/召回的部分。
- P1 Mem0 生命周期、Mem0 分页、索引恢复与多索引一致性。
- 技术栈模块：T14、T18–T24。
- 第 5 节 Mem0、记忆层级、真实语料/GraphRAG 和索引可靠性优化项。

## 独占源码范围

- `apps/rag-api/src/modules/memory/`
- `apps/rag-api/src/modules/document/`
- `apps/rag-api/src/modules/graph/`
- `apps/rag-api/src/modules/rag-admin/`
- `apps/rag-api/src/providers/mem0/`
- `apps/rag-api/src/providers/vector-store/`
- `apps/rag-api/src/providers/elasticsearch/`
- `apps/rag-api/src/rag/agentic/`
- `apps/rag-api/src/rag/answer/`
- `apps/rag-api/src/rag/evidence/`
- `apps/rag-api/src/rag/generation/`
- `apps/rag-api/src/rag/indexing/`
- `apps/rag-api/src/rag/planning/`
- `apps/rag-api/src/rag/retrieval/`
- `apps/rag-api/src/rag/rag.service*.ts`

真实文档、授权数据和线上业务规则不在窗口内虚构或生成。避免修改窗口 1 的 Agent/工具模块、窗口 3 的队列/可观测/评测脚本、窗口 4 的 Sandbox/Admin UI。

## 当前已知实现，避免重复造轮子

- 周度记忆归纳默认关闭，已有来源指纹、审批/驳回/撤销、失效处理与 Outbox 重放查重；stale 提案不再永久占用有效来源。
- BM25 快照使用同目录临时文件、fsync 和原子 rename。
- Reconciler 使用精确修复原因白名单，已处理 `missing_chunks` 并在分页任务全部入队后推进游标；可修复的检索描述错误会入队，服务/审计不可用与元数据计数错误不会误排队。
- 文档入库等待两个 Elasticsearch sibling 写入 settle 后才进入失败补偿清理。
- 文档检索与 Graph 查询均使用 ACL 允许的文档 ID；Graph 按关系 sourceIds 求交并过滤返回来源，最终仍复核 ACL、生命周期和业务范围；RagGateway 已把当前 user/tenant 传到 reviewed evidence 查询，身份存在时关闭无租户字段的全局 Bad Case 语义召回。`/debug/chunks` 已移除匿名访问并传递当前 JWT 用户 ID。
- 真实评测夹具目前是 synthetic，不能宣称真实召回或质量提升。

## 本机运行时验收状态（2026-10-31）

- `http://localhost:3000/api/v1/health` 返回 200；能力接口报告 Milvus、BM25、Elasticsearch 可用，GraphRAG 与 rerank 不可用。
- 当前监听进程在本轮源码修改前启动；磁盘上的 `dist` 有新 Graph ACL 编译产物，但运行进程未加载本轮改动，不能据此验收新代码。
- 没有真实用户 JWT，未调用快/深检索或聊天路径；因此共享 ACL/撤权、GraphRAG 端到端和真实答案/引用仍未验收。完整聊天会写会话、日志和记忆，不以管理员模拟身份或虚构问答代替真实用户验证。

## 执行规则

1. 先检查 `git status --short` 和目标文件现有 diff；不要覆盖共享工作树已有修改。
2. 只做有证据的本地功能修复；不得猜测数据来源、ACL 继承、组织记忆 scope 或真实评测标签。
3. 不运行单测。涉及检索/答案代码的改动按项目规范需用快速/深度真实用户路径验证；若缺少可安全调用的目标服务或样本，明确记录，不用模拟结果冒充。
4. 四个窗口并行期间不运行共享 `dist/` 全量 build；完成后报告修改文件、静态验证和不能验收的真实数据项。主窗口统一合并 ROADMAP/缺口清单。

## 外部前置，不得标成已完成

授权游戏官网/活动资料、至少 100 条人工复核金标准与 holdout、真实 ACL、Mem0 目标版本和真实记忆、GraphRAG 组织主数据、真实指标基线与多索引故障演练均需相应资料/服务提供。
