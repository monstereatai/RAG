# 执行与验证记录

用户明确批准全路线图并要求直接实施，之后要求功能优先。P0/P1a 原状态机用于原小切片，实际执行范围扩大为 P1/P2/P3 并行重构与 P4/P5 现有职责审计；原始 T001-T005 检查已执行，但本文件不宣称人工 acceptance 或真实环境验收通过。

实施结果、实际命令、已知失败与用户原有修改保留证据见 `docs/refactor/progress.md`、`docs/refactor/04-test-and-evaluation.md`、`docs/refactor/evidence/scope-and-contract.json`。最终全仓构建通过；本轮相关 13 suites / 147 tests PASS，检索专项 5 suites / 25 tests PASS；新增代码 lint 0 error，ESLint 基线差异检查无新增诊断。全量 Jest 已运行：113 suites 中 106 PASS、7 FAIL，590 tests 中 570 PASS、20 FAIL；失败集中在本轮未改动的 rag-admin、team-wiki、feishu、conversation-embedding、domain-events 模块，详见 `docs/refactor/evidence/full-jest.txt`。真实三模式、全量新旧质量/延迟/成本、压力/故障验证未运行，不能标记人工 acceptance。

已发现并明确记录的行为修复：扩展块生命周期门禁、系统上下文预算、总结语义清洗与可取消超时。历史有效期查询已按查询区间与文档有效期相交实现，草稿/归档排除，普通查询保持当前时间语义。

## 2026-10-29 Karpathy 退场补充

- `KarpathyRagService` / `KarpathyRagModule` / `rag/karpathy` 已删除并迁移为 `RagService` / `RagModule`。
- 新增 `RAG_QUERY_CAPABILITY`、`RAG_RETRIEVAL_CAPABILITY`、`RAG_INDEX_CAPABILITY`、`RAG_ADMIN_CAPABILITY`；业务模块改为能力注入。
- `ObsidianIngestService` 取代 Karpathy-Obsidian 命名；BM25 文件格式保持兼容。
- 定向 13 suites / 147 tests、backend build 通过；`RagService` 内部仍较大，索引仓储与回答编排拆分列为后续独立批次。
