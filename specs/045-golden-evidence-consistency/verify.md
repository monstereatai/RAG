# Verification — 045 Golden Evidence Consistency

## Scope

本变更补充业务黄金评测集，并让 Simple、Auto、Agentic 在证据排序、受约束生成、引用校验和安全降级上复用同一套规则。

## 验证结果

| 项目 | 结果 | 证据 |
|---|---|---|
| 黄金集结构 | 通过 | `cd backend && npm run eval:golden-business`：86 条案例、37 份样本文档、6 个维度、0 个结构错误 |
| 三模式响应契约 | 通过 | `src/test/chat-modes.integration.spec.ts`：7／7；同一响应契约保留 `answer`、`references`、`retrievalSufficient` |
| 证据排序与生成兜底 | 通过 | Karpathy／Agentic 定向测试：50／50；Rerank 候选优先，未重排候选回退 RRF 分数 |
| Backend 构建 | 通过 | `cd backend && npm run build` |
| 既有 Agent 平台门禁 | 通过 | `cd backend && npm run eval:agent-platform`：路由 12／12、Agent Task 8／8、Production Workflow 10／10 |
| 真实黄金集回放 | 阻塞 | `GOLDEN_EVAL_REQUIRE_LIVE=true npm run eval:golden-business` 在上传样本文档阶段返回 HTTP 500；后端日志显示 Redis `MISCONF`（RDB 快照无法持久化，写入被禁止），不能据此宣称线上准确率 |

## 结论

- 代码层面已完成：Agentic 并发汇合后不再只按旧 `totalScore` 排序；共享证据排序器按 `rerankScore → totalScore(RRF)` 工作。
- 三条链路生成回答都经过统一的引用门禁；门禁失败时依次尝试受约束语义总结、结构化证据抽取，最后安全降级，不把未验证草稿当成最终答案。
- 黄金集是仓库内脱敏／项目样本基线，不是真实生产业务集。接入真实内部资料后，应重新执行 `GOLDEN_EVAL_REQUIRE_LIVE=true`，再由业务专家确认参考答案和引用片段。
- 当前真实回放阻塞点是 Redis `MISCONF` 导致的上传接口 HTTP 500；本次未修改 Redis 配置、数据库结构，也未绕过该失败。
