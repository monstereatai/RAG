# Remaining Enterprise Enhancement Plan

> 本文只记录一线大厂落地视角的剩余差距、可本地补齐项和必须外部输入项。会变化的进度同步到 `ROADMAP.md`，历史细节不要继续堆到 ROADMAP。

## 当前判断

项目已经具备企业级 RAG 原型能力：文档解析、混合检索、GraphRAG、Agentic RAG、多模态脚手架、评测集、后台运营、可观测入口和模拟私密数据都已补齐。

距离一线大厂生产可用，差距不在“有没有 RAG 链路”，而在真实数据、真实权限、真实压测、真实可观测、真实安全审计和生产运维闭环。

## 已本地补齐

| 方向 | 本地补齐内容 | 验收方式 |
|------|--------------|----------|
| 私密业务问题集 | 193 条模拟业务问题、标准答案、来源文档字段 | `npm run eval:business-private` |
| 私密业务文档 | 27 个脱敏本地文档，覆盖 HR/Finance/Legal/Security/Ops/CS/Product/Data/Engineering | `npm run fixtures:private:check` |
| GraphRAG 初始数据 | schema、实体类型、关系类型、别名规则、初始实体关系、15 条语料 | `npm run graph:import-private` |
| 组织权限模拟 | 20 部门、22 岗位、8 用户、4 角色、继承规则、权限回显样例 | `npm run fixtures:private:check` |
| 多模态样本 | 图片、音频、视频、OCR sidecar、transcript sidecar、10 条查询 | `npm run smoke:vision-video` |
| 外部工具 smoke | Bocha、Rerank、Judge 的 key 缺失降级和 required 模式 | `npm run smoke:external` / `npm run smoke:external:required` |
| Milvus 基础治理 | index smoke、timeout/warmup/circuit breaker 相关脚手架 | `npm run smoke:milvus` |
| 性能基准脚手架 | simple/agentic p50/p95 基准脚本 | `npm run perf:rag` |
| 部署清单 | 基础设施、Nginx、备份、监控、回滚 checklist 模板 | `DEPLOYMENT_CHECKLIST.md` |
| 企业级 readiness 汇总 | 统一检查数据、脚本、文档、外部阻塞 | `npm run enterprise:readiness` |
| Prompt Injection 基础防护 | 检索片段本地检测/高风险行脱敏、prompt 边界、专项评测集 | `npm run eval:prompt-injection` |
| Prompt Registry 基础版 | prompt name/version/owner/evals/rollback 代码级登记 | `npm run prompt:registry:check` |
| Tool Registry 基础版 | 工具 risk/permission/timeout/audit/fallback/owner 代码级登记 | `npm run tools:registry:check` |
| Agent 任务评测脚手架 | retrieval/refusal/conflict/citation/tool_degrade 覆盖检查，支持 live gate | `npm run eval:agent-tasks` |
| 游戏活动/官网营销专项评测 | 8 篇业务模板文档 + 96 条问题，覆盖新角色抽奖、周年庆、充值返利、微信分享、游戏官网、版本专题、兑换码、回流活动 | `npm run eval:game-marketing` |
| 产研协作 Agent 平台 | 六岗位 DAG、并行批次、风险审批、局部重跑、证据门禁、异步状态、产物和专项评测 | `npm run eval:production-workflow` |
| Milvus Bad Case 闭环 | `2.4.19` 服务端 + `2.4.10` SDK，完成 insert、flush、向量检索、标量读回和清理 | `npm run smoke:milvus:bad-case` |
| 资深岗位证据工程 | 真实业务逐题 API 评测、Agent 重复回放、p95／错误率性能门禁、运维 smoke 聚合、五份 ADR 和高级／Staff 证据汇总 | `npm run evidence:business`、`evidence:stability`、`perf:rag`、`evidence:operations`、`evidence:readiness` |

## 必须外部输入

| 阻塞项 | 为什么不能模拟成完成 | 需要提供 |
|--------|----------------------|----------|
| 真实业务原件 | 模拟文档无法覆盖公司制度版本冲突、黑话、例外条款和真实引用责任 | 可脱敏 PDF/DOCX/XLSX/网页导出、版本号、所属部门、权限标签 |
| 真实毒题集 | 模拟问题无法代表真实高频工单、灰度政策、跨部门冲突和拒答边界 | 50-100 条真实问题、标准答案、来源文档、期望引用 |
| 真实游戏活动/官网营销资料 | 专项数据集已能证明业务建模方向，但不能代表真实项目的组件、埋点、接口、复盘事故和地区发行口径 | 历史活动复盘、游戏官网组件文档、埋点规范、接口契约、地区上线 checklist、测试问题单 |
| 真实组织系统 | 权限继承、岗位兼任、离职转岗、外包账号需要和主数据系统一致 | 部门树、岗位、用户、角色、继承规则、同步方式、样例回显 |
| 真实 GraphRAG 数据源 | 业务实体/关系/别名规则强依赖公司知识结构 | 实体类型、关系类型、别名规则、种子数据源、冲突合并规则 |
| 真实视觉/视频模型 | sidecar 只能证明入库结构，不能证明 OCR/ASR/视频理解质量 | `VISION_PROVIDER`、模型 key、图片/视频/音频样本、准确率标准 |
| 外部模型与工具长期稳定性 | Qwen 超时预算修复后连续三次完整 DAG 已达到 18／18 模型成功、0 降级；三次本地回放仍不能代表长期生产 SLA | Bocha、DashScope/Qwen/Rerank/Judge 的正式配额、SLA、限流、跨时间窗口回放和故障窗口 |
| 真实 Milvus/ES 压测 | 本地小数据无法代表生产 collection、分片、索引、冷启动和熔断阈值 | 机器规格、数据量、并发目标、SLA、压测窗口 |
| 登录后管理后台 E2E | 无登录态只能验证认证重定向，不能证明审批、下载和分享的完整交互 | 可用测试账号或自动化测试身份、目标浏览器和验收视口 |
| 生产目标环境 | 触碰机器、域名、证书、备份、监控属于部署红线 | 目标机器、域名、证书、备份策略、监控接入方式、发布权限 |
| 安全合规审计 | 代码可做技术防护，但合规需要组织规则和审计口径 | 数据分级、保留周期、脱敏规则、审计字段、等保/内审要求 |
| 真实组织影响证据 | 代码能提供六岗位协作和证据模板，但不能虚构多个团队采用、交付收益和线上事故 | 团队接入记录、指标来源、真实事故复盘、改进项闭环和平台采纳证明 |

## 大厂验收口径

### RAG 质量
- 业务毒题集准确率、拒答率、引用命中率、权限过滤通过率都有门槛。
- 每个答案必须可追溯到文档、片段、检索分数、重排分数、模型和 trace。
- 低置信度必须拒答或转人工，不允许“编一个看起来合理的答案”。

### 数据链路
- 文档入库需要版本、来源、权限、解析状态、切片状态、向量状态、索引状态。
- 向量、ES、图谱三套索引要能重建、对账、回滚。
- 删除/权限变更要能触发向量、ES、图谱同步失效。

### 权限安全
- 检索前、检索后、引用展示都要做权限过滤。
- 管理后台操作需要 RBAC、审计日志、敏感配置脱敏。
- 多租户隔离不能只靠 prompt，要在存储和查询条件上隔离。

### 可观测
- 需要 latency、token、cost、召回率、无答案率、外部工具失败率、队列堆积、索引延迟。
- 每次回答能串起 requestId/traceparent/conversationId/documentId/chunkId。
- 外部供应商故障要有降级策略和告警。

### 运维
- 生产部署必须有备份、恢复演练、容量计划、发布回滚、密钥轮换。
- Milvus/ES/Neo4j/Postgres/Redis/对象存储都要有健康检查和恢复预案。
- 压测需要覆盖冷启动、热缓存、批量导入、并发问答和外部工具超时。

## 推荐下一步

1. 用真实业务原件和 50～100 条毒题替换模拟 fixture，运行真实质量门禁。
2. 对六岗位完整 DAG 做至少 30 次跨时间窗口回放，确认当前连续三次 18／18 的结果可长期保持。
3. 接入真实组织、GraphRAG 和视觉／视频数据源，验证权限、关系和多模态质量。
4. 在目标规格机器运行 `perf:rag`、两条 Milvus smoke 和长时间稳定性测试。
5. 使用登录后的管理后台 E2E 覆盖审批、局部重跑、产物下载和分享。
6. 根据真实结果调整 chunk、retrieval、rerank、GraphRAG schema、模型路由和拒答阈值。
7. 按 `docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md` 连续产出业务、稳定性、性能、运维和真实组织证据，再运行 `npm run evidence:readiness`；缺失项保持缺失，不用模拟结果补齐。
