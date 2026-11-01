# 真实导出资料驱动的 RAG Golden 开发候选集

**不是正式 Golden 验收报告，不会为 100 条发布门禁造假。**

## 已确认的事实
- 第二份 HR 导出：3 个文档 × 3 Chunk = 9 条切片；Milvus `rag_chunks` 只读按 ID 检查 9/9 命中，0 缺失。
- 三份 HR 文档完整正文逐字相同，且版本均为 `2026版`，所以逻辑上**只有 3 条不同的 HR 原文片段**。
- 三份 HR 文档为 `lifecycleStatus=draft`，尽管 `reviewStatus=approved`，且数据库 `effectiveAt=null`；不能据正文的「自 2026-01-01 生效」推导已正式发布。
- 第一份技术导出：3 份 `effective/approved` 技术简介，每份 1 Chunk；补充导出确认 Milvus 3/3 存在。
- 合计 6 份记录、12 个实际 Chunk，但只包含 6 段不同正文。**Milvus ID 存在不等于检索召回/权限/质量验收通过。**

## 交付内容
- `apps/rag-api/.tmp/private-golden/source_grounded_31_dev_candidates.json`：31 条开发测试候选（12 条技术资料 + 19 条差旅制度/状态治理）。
- `apps/rag-api/.tmp/private-golden/source_audit.json`：重复索引与状态冲突诊断。
- `apps/rag-api/.tmp/private-golden/source_extracts/`：由数据库切片**派生**的快照，不能当作原始上传文档或独立来源证明。
- `apps/rag-api/scripts/verify-source-grounded-dev-candidates.mjs`：离线验证字段引用、快照摘要、待审状态一致性，绝不会产生发布通过结论。

## 用法（在 RAG 项目根目录）
把本压缩包内容按目录复制进 RAG 根目录，**保持 `.tmp/private-golden/` 目录结构不变**（私有数据默认放在此目录，切勿提交公开 GitHub）。

```bash
cd apps/rag-api
node scripts/verify-source-grounded-dev-candidates.mjs
```

审阅数据：

```bash
open .tmp/private-golden/source_grounded_31_dev_candidates.json
```

**注意**：`31` 只是测试问题总数，不是 31 个独立业务事实，且不含真实运行结果。

## 使用前的关键分流
1. `sourceMode=offline_source_validation`：仅核对草稿原文是否与候选问题匹配；不应该在正式 RAG 问答里引用草稿。
2. `sourceMode=real_api_pending`：需要真实 API 的当前租户、身份与权限下测试，**不得把草稿回答当作正确答案**。
3. `sourceMode=data_quality_check/index_membership_check`：静态数据质量/向量成员核对，不属于模型问答准确率。
4. `sourceMode=live_candidate_needs_real_api_run`：技术资料的问题可作为实际 RAG 问答候选题，但仍缺来源证明、实际 Run 和独立人工审核。

## 进入真正的 Golden 质量门禁还欠什么？
- 必须有原始来源 `sourceUri`、受信任的 source snapshot 及审定人员。
- 按业务规则把应该对外生效的文档正确发布，或者保留 `draft` 以测试其被拒绝引用；**不自动修改生命周期状态**。
- 真实 RAG/Agent Run、检索命中文档和 chunk、引用、错误/拒答结果。
- 专门的 ACL 身份/租户环境（当前导出 `tenantScoped=false`，不能宣称权限隔离通过）。
- 原先 100 条候选属于游戏研发/活动/Agent 领域，这些样本文档无法可靠填满该题库；要继续正式验证，还需**相同业务领域**的真实来源。

安全：请审核脱敏状态，不要将私有知识库正文、凭据或测试报告提交到公开 GitHub。
