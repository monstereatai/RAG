# 架构重构实际进度

## Batch 0 — 2026-10-29

- 状态：done（源码审计/基线文档）；真实环境验证 NOT RUN。
- 目标：锁定当前实现、原有失败和对外契约。
- 改动：docs/refactor/、Docs Index；真实基线见 00-baseline.md，模块证据见 01-module-audit.md。
- 原模块 → 新模块：本批未改业务代码。
- 兼容性：API/SSE/DB/配置/权限/引用未改。
- 已执行验证：改码前 pnpm build PASS；全量 Jest/lint FAIL，数量见基线；文档格式和索引 Diff 检查由主 Agent 记录。
- 遗留风险：既有失败、真实服务/三模式回放待检查。
- 下一批：Evidence Policy、文档索引协调、Context/Runtime 边界，分别验证后集成。

## Batch 1 — 2026-10-29

- 状态：partial（代码已接入、全仓构建通过；最终行为回归未收口）。
- 目标：共享召回、证据策略和生成能力，Agentic 不再导入 Karpathy 实现。
- 原模块 → 新模块：Karpathy 候选融合/RRF/范围过滤/重排/展开 → `rag/retrieval/retrieval-postprocessor.ts`；ES/BM25/Milvus/描述召回与降级 → `retrieval-sources.ts`；ContextBuilder → `rag/retrieval/context-builder.ts`，原路径 re-export。Evidence Quality/确定性答案/引用门禁 → `rag/evidence/`；通用 grounded/correction/synthesis/模型流式降级 → `rag/generation/`。
- Agentic 通过四个窄能力契约使用正式召回、快路径、Simple 降级和补充证据；Nest 的 useExisting 仍指向兼容 Facade。Karpathy 用 implements 显式校验实现契约。BM25 原索引状态与文件格式继续由现有入口持有。
- 兼容：RRF K=60、BM25=.3/cosine=.7，totalScore 与 rerankScore 保持原含义；生成前由检索能力排序和补规则邻居，生成器保留本地引用顺序；原路径/公开方法/DTO/路由保留。
- 明确行为修复：邻居/同章节扩展重新检查 draft/archived/生效/过期，修补原 HEAD 已有的不可见片段回流；生成的语义总结兜底也调用现有 sanitizeUntrustedContext；总结超时信号下传并及时清理定时器。
- 验证：检索/Context 3 suites、12 tests PASS（`evidence/retrieval-tests.json`）；新 Evidence focused 9 tests PASS（agent 报告）。最新全部实现经 `pnpm build` PASS；之后加入窄契约 implements，再次 backend build PASS。中间整合定向测试 109/119 PASS，详见 integration-tests.json；其中子 Agent 中断留下的 fixture/过期方法路径已修正但按用户“功能优先”指令未再完整复跑。不能把该中间报告描述为最终全绿。
- 余项：BM25 仓储仍在 Facade；不声称已消除所有大型用例方法。真实三模式、最终全量回归待运行。

## Batch 2 — 2026-10-29

- 状态：done（本地代码与针对性验证）；真实索引故障联调 blocked。
- 原模块 → 新模块：DocumentService 的主/增量索引写入、ES/BM25 生命周期投影、失败清理、Milvus Redis 删除补偿 → `DocumentIndexCoordinator`。PG/ACL/版本/原件、Graph、图片、retrieval description 仍由各既有责任方处理。
- 兼容：保留同步 throw 包装成 Promise、allSettled 等待、原有增量写入顺序和补偿未持久化即阻止删除 PG 的边界；Redis key、重试/恢复规则不变。没有 Schema/迁移/数据操作。
- 验证：Document 2 suites、13 tests PASS（agent 执行记录 `specs/046-rag-agent-architecture/p2-document-index-coordinator.log`）；整仓 build PASS。独立源码审阅确认原写入/删除顺序。
- 余项：完整 ES/BM25/Graph 对账器未新增，仍为原有 Milvus 删除补偿；解析格式 utility 保留复用，未机械拆成格式类。

## Batch 3 — 2026-10-29

- 状态：partial（代码与编译完成，最终三模式行为验证待运行）。
- 原模块 → 新模块：RequestContext、RequestMode、ExecutionPlan、附件 evidence loader 契约迁至 `rag/contracts/`；旧 Chat/Planning 导出兼容。BadCase/Obsidian 的消费类型迁到各自 types 文件，contracts 不再 import 业务 Service。
- 功能：Chat 对系统策略、岗位规则、Mem0 会话/用户记忆、历史摘要、历史向量标注来源并执行系统上下文预算。必需规则完整保留；可选上下文按 session memory > summary > user memory > history search 整块选取。必需规则超过预留时继续压缩历史预算，并记录实际 estimated/dropped/overflow。没有预算测量的直连 Agentic/旧 checkpoint 不伪造 0 值。
- 明确行为变化：原来仅给历史减去 2048 token reserve、但 memoryMessages 可无限增长；现在该 reserve 被实际执行，过大记忆可能不被注入。保留 MemoryService 旧 systemMessage 格式及 trust guard；Chat 策略不重复注入。
- 估算边界：复用既有 CJK×0.75 + 其他字符/4 的近似估算，加每消息 4 token 开销，不等同 Provider tokenizer；不能宣称生产 token 上限绝对保证。
- 验证：Chat/Memory 新用例在中间定向报告内通过，ShortTermMemory 原摘要持久化断言与当前 IsNull 条件不一致已校正，未最终复跑。最新 backend/全仓 build PASS。

## Batch 4–5 — 2026-10-29

- 状态：done（现有职责审计和保持；真实恢复/后台验收 blocked）。
- AgentLoop 执行循环、AgentRuntime 计划/岗位运行、AgentRuns 观测、AgentTasks DAG、RuntimeEvents 事件、LangGraph Checkpoint 恢复、Artifact 版本/存储职责不同，保留现存实现，没有创建第二套状态库或 Workflow engine。
- HTTP/SSE/AGUI 已复用 ChatService，后台 rag-client 已走 HTTP 运营 API；本轮 AGUI 仅迁移共享契约 import。QueryPlan 一次构造并复用的回归保留。
- 验证：运行/工具/工作流/产物相关 17 suites、80 tests PASS，见 runtime-tests.json。64 个公开契约源码快照仅 ChatMode 类型 alias 和 AGUI type import 发生变化；具体 diff 与 scope-and-contract.json 已检查。原有 11 个用户修改文件哈希保持一致（ROADMAP 另做增量维护）。

## Batch 6 — 2026-10-29

- 状态：partial，用户要求先实现功能，本轮停止扩大测试范围。
- 已执行：`pnpm build` PASS；最新 `pnpm --dir backend run build` PASS；`git diff --check -- backend docs/README.md docs/refactor` PASS。新文件 lint 曾发现 3 errors/1 warning（迁移代码类型/多余 await），已修正，最终状态见新报告。
- 未执行：最终全量 Jest/lint、真实三模式 UI、Golden/质量/成本/延迟对比、故障与压力联调；见 blocked-validation.md。
- 历史有效期口径：主人已确认采用“查询时段与文档有效期相交”的主流规则；该实现见 Batch 7。QueryPlan.filters.timeRange 仍只作为软信号，不直接变成权限或文档硬过滤。

## Batch 7 — 2026-10-29

- 状态：done（代码、构建与本轮定向回归）；真实 ES/Milvus/PostgreSQL 联调和三模式 UI 仍 blocked。
- 目标：完成历史有效期查询，普通查询继续按当前时间判断。
- 业务口径：查询区间与文档 `effectiveAt` / `expiredAt` 有效期有交集即返回授权旧版本；区间采用左闭右开 `[from, to)`；草稿、归档始终排除；历史查询默认允许 deprecated 版本。示例“2025 年 9—10 月有效规则”解析为 `[2025-09-01, 2025-11-01)`。
- 实现：新增 `EffectiveTimeRange`、自然语言年月区间解析与相交判断；RetrievalPolicy 将显式历史问题转为 local-only scope。ES BM25/kNN、Milvus 后过滤、描述索引回原文、章节扩展、规则邻接扩展、Obsidian 原文映射以及 Graph/Image 证据可见性都贯穿同一有效时间范围。
- 兼容：未改 HTTP/SSE/AG-UI、DTO、数据库 Schema、ACL 或索引写入格式；普通查询仍按当前时间过滤，`QueryPlan.filters.timeRange` 不作为硬过滤。
- 验证：`pnpm build` 六 workspace PASS；`pnpm --dir backend run build` PASS；本轮相关 13 suites / 144 tests PASS（`integration-tests.json`）；检索专项 5 suites / 25 tests PASS（`retrieval-tests.json`）；新增代码 ESLint 报告 29 个文件 0 error / 0 warning（`new-code-lint.json`）；ESLint 基线差异检查无新增诊断（baseline 90 / current 44）。全量 Jest 已执行：113 suites 中 106 PASS、7 FAIL，590 tests 中 570 PASS、20 FAIL；失败集中在本轮未改动的 rag-admin、team-wiki、feishu、conversation-embedding、domain-events 模块，见 `full-jest.txt`，因此不能宣称全量 Jest 全绿。
- 未执行：真实 simple/auto/agentic UI、Golden/质量/成本/延迟、ES/Milvus/PostgreSQL 故障与压力联调。不能把本轮 Mock 定向回归当成生产验收。

## Batch 8 — 2026-10-29

- 状态：done（Karpathy 命名与兼容 Facade 退场；能力边界重构完成代码与定向验证）。
- 目标：按任务书“删除需批准、兼容 Facade 分阶段退场”的原则，把旧 `rag/karpathy` 目录和 `KarpathyRagService` 改为中立的 RAG 应用服务，并阻止业务模块继续直接依赖具体实现。
- 结构变化：`rag/karpathy/karpathy-rag.service.ts` → `rag/rag.service.ts`；模块 → `rag/rag.module.ts`；BM25 工具迁至 `rag/indexing/`；cosine、planned-query fusion、supplemental evidence retriever 迁至 `rag/retrieval/`；Karpathy-Obsidian 双写服务改为 `ObsidianIngestService`。
- 能力边界：新增 `RAG_QUERY_CAPABILITY`、`RAG_RETRIEVAL_CAPABILITY`、`RAG_INDEX_CAPABILITY`、`RAG_ADMIN_CAPABILITY`。Chat、gRPC、RAG Gateway、RAG Admin、RAG Ops、Document Index Coordinator、Workflow、Platform Governance、Debug 均改为注入能力 token；Agentic 仍通过四个窄能力契约使用 RAG。
- 兼容：BM25 JSON 文件路径与格式不变；HTTP/gRPC/SSE/AG-UI、DTO、ACL、索引写入行为未改；`governedDirectAnswer` 取代旧内部选项名，Simple 路由标签改为 `linear_rag`。
- 未完成：`RagService` 仍是约 3500 行的线性编排实现，BM25 状态仓储与回答编排尚未拆成独立类；本轮先完成命名退场和能力边界，避免一次性重写改变行为。
- 验证：backend build PASS；全仓 build PASS；本轮相关 13 suites / 147 tests PASS；检索专项 5 suites / 25 tests PASS；能力边界新增/迁移文件 lint 12 个文件 0 error / 0 warning；ESLint 基线差异检查无新增诊断（baseline 90 / current 43）。全量 Jest：113 suites 中 106 PASS、7 FAIL，590 tests 中 570 PASS、20 FAIL；失败集中在本轮未改动的 rag-admin、team-wiki、feishu、conversation-embedding、domain-events 模块。
- 脚本验证：`node backend/scripts/smoke-rag-pipeline.mjs` 40/40 PASS（ES kNN fallback/always/off、rerank、RAG Gateway 字段）；`node backend/scripts/eval-rag-maturity.mjs` 可执行完成，静态门禁通过，外部生产材料/Milvus runtime 仍标为不阻塞的剩余项。


## Batch 9 — 2026-10-29

- 状态：done（RAG 大型服务拆分完成；本地编译、定向回归、smoke 与 lint 基线已验证）。
- 目标：在 Batch 8 命名退场和能力 token 的基础上，把仍由单个 `RagService` 承担的索引、检索、证据、Obsidian 和回答编排全部拆成窄服务，满足“所有内容重构完才停止”的验收口径。
- 结构变化：
  - `RagIndexService` 独占 BM25 内存索引、`workspace/bm25-index.json` 路径/JSON 持久化、索引增删改查与统计。
  - `RagChunkPolicyService` 承接 metadata、ACL/scope/lifecycle、来源权威、RRF、rerank、上下文扩展与描述命中回原文。
  - `RagRetrievalService` 只保留普通/计划/详细检索与 BM25 兜底编排。
  - `RagEvidenceService`、`RagObsidianService` 分别承接证据/引用门禁和 Obsidian source note 映射。
  - `RagFastPathService`、`RagDirectAnswerService`、`RagGroundedAnswerService`、`RagAnswerFallbackService` 承接 Auto Fast Path、直答门禁、受约束生成/引用降级和联网/模型/会话兜底；`RagAnswerService` 只保留线性问答用例编排。
  - `RagService` 收敛为 406 行组合 Facade，只实现组合能力契约和委托，不再持有 BM25、检索 provider 或回答算法。
- 能力 token：`RAG_QUERY_CAPABILITY` 与 `AGENTIC_SIMPLE_ANSWER_CAPABILITY` 绑定 `RagAnswerService`；`AGENTIC_FAST_PATH_CAPABILITY` 绑定 `RagFastPathService`；`RAG_INDEX_CAPABILITY` 绑定 `RagIndexService`；检索/补充证据/Admin 的组合契约由 `RagService` Facade 组合。
- 兼容性：HTTP/gRPC/SSE/AG-UI、DTO、ACL、引用结构、BM25 JSON 路径与格式未改；未改数据库 Schema/迁移、`.env` secrets、CI/CD 或生产配置。
- 验证：backend build PASS；全仓 `pnpm build` PASS；RAG/Agentic/Chat/文档索引/Gateway 定向 5 suites / 95 tests PASS；RAG 定向回归 28 suites / 214 tests 中 201 PASS，13 个失败均为既有 rag-admin 失败且与重构前完全一致；`node backend/scripts/smoke-rag-pipeline.mjs` 40/40 PASS；全量 Jest 113 suites / 590 tests，106 suites / 570 tests PASS，7 suites / 20 tests FAIL，失败集合与 Batch 8 基线一致（rag-admin、team-wiki、feishu、conversation-embedding、domain-events）；新增/迁移文件 ESLint 通过，ESLint 基线差异检查无新增诊断。
- 管理后台边界：`admin/src`、`admin-backend/src` 及重新构建后的 `admin/dist`、`admin-backend/dist` 均无 Karpathy 残留；管理后台只通过 `RagClientService` 的 HTTP 合约访问 RAG，不 import 具体 RAG 实现。`pnpm --dir admin run build`、`pnpm --dir admin run tsc`、`pnpm --dir admin-backend run build` 均 PASS；admin-backend 的 rag-client/search-ops 定向 2 suites / 40 tests PASS。
- 未执行：真实 simple/auto/agentic UI、真实 ES/Milvus/PostgreSQL 故障与压力联调、Golden 质量/成本/延迟对比；这些属于外部环境验收，不把 mock 定向回归当作生产验收。
