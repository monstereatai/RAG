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

## 必须外部输入

| 阻塞项 | 为什么不能模拟成完成 | 需要提供 |
|--------|----------------------|----------|
| 真实业务原件 | 模拟文档无法覆盖公司制度版本冲突、黑话、例外条款和真实引用责任 | 可脱敏 PDF/DOCX/XLSX/网页导出、版本号、所属部门、权限标签 |
| 真实毒题集 | 模拟问题无法代表真实高频工单、灰度政策、跨部门冲突和拒答边界 | 50-100 条真实问题、标准答案、来源文档、期望引用 |
| 真实组织系统 | 权限继承、岗位兼任、离职转岗、外包账号需要和主数据系统一致 | 部门树、岗位、用户、角色、继承规则、同步方式、样例回显 |
| 真实 GraphRAG 数据源 | 业务实体/关系/别名规则强依赖公司知识结构 | 实体类型、关系类型、别名规则、种子数据源、冲突合并规则 |
| 真实视觉/视频模型 | sidecar 只能证明入库结构，不能证明 OCR/ASR/视频理解质量 | `VISION_PROVIDER`、模型 key、图片/视频/音频样本、准确率标准 |
| Bocha/Rerank/Judge key | 无 key 只能验证降级，不能验证真实外部增强质量 | Bocha、DashScope/Qwen/Rerank/Judge key 和配额 |
| 真实 Milvus/ES 压测 | 本地小数据无法代表生产 collection、分片、索引、冷启动和熔断阈值 | 机器规格、数据量、并发目标、SLA、压测窗口 |
| 生产目标环境 | 触碰机器、域名、证书、备份、监控属于部署红线 | 目标机器、域名、证书、备份策略、监控接入方式、发布权限 |
| 安全合规审计 | 代码可做技术防护，但合规需要组织规则和审计口径 | 数据分级、保留周期、脱敏规则、审计字段、等保/内审要求 |

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

1. 用真实业务原件替换模拟 fixture，跑 `fixtures:private:prepare` 和 `eval:business-private`。
2. 接入真实组织系统样例，验证权限过滤和权限回显。
3. 配置 Bocha/Rerank/Judge/Vision key，跑 required smoke。
4. 在目标规格机器跑 `perf:rag`、Milvus smoke 和长时间稳定性测试。
5. 根据真实评测结果调整 chunk、retrieval、rerank、GraphRAG schema 和拒答阈值。
