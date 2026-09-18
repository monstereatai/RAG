# 实施计划：业务黄金评测集与三链路证据一致性

## 已确认上下文

- 相关模块：`backend/eval`、`backend/scripts/eval-*`、`backend/src/rag/karpathy`、`backend/src/rag/agentic`、`backend/src/test`、CI 和 ROADMAP。
- 现有行为与约束：Karpathy 已实现 BM25／向量／ES、RRF、DashScope Rerank、权限和引用门禁；Agentic 通过同一 Karpathy 检索入口召回，但汇合时重新按 `totalScore` 排序，并有一套重复的生成兜底。
- 不确定项：Milvus 当前可能反复重启，完整真实回放可能无法完成；离线校验和单测不能替代真实业务准确率。

## 方案

- 数据流／状态流：从已有脱敏业务集和项目级文档集建立 50～100 条黄金案例清单；每条记录来源、领域、问题类型、是否多轮、冲突／拒答／引用要求、期望来源策略和 Auto 路由。校验脚本默认离线运行，真实模式复用 `/api/v1/chat`，按三模式保存结果。
- 证据排序：在 Karpathy 暴露统一的证据排序函数，比较候选时优先使用 `rerankScore`，缺失时使用 `totalScore`；Agentic retrieval 汇合和最终上下文统一调用该函数，保留去重、权限、版本和来源权重。
- 生成边界：抽取 Karpathy 的“基于固定证据生成、修复引用、语义总结、引用门禁、安全降级”公共能力；Agentic 生成节点复用该能力，不改变 Agentic 的查询规划、并发检索、Reflection 和审批节点。
- 兼容性与回退：无 Rerank 分时保持现有 RRF 行为；公共能力失败时沿用现有安全降级；黄金集 live 依赖不可用时返回阻塞报告，不把 skipped 当通过。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `backend/eval/golden-business.dataset.json` | add | 记录 50～100 条黄金案例索引、来源和验收维度 | AC-01、AC-02 |
| `backend/scripts/eval-golden-business.mjs` | add | 离线 schema／覆盖校验与可选三模式真实回放 | AC-01、AC-02 |
| `backend/package.json` | modify | 增加黄金集评测命令 | AC-01、AC-02 |
| `.github/workflows/quality-gate.yml` | modify | CI 增加离线黄金集门禁 | AC-01、AC-05 |
| `backend/src/rag/karpathy/karpathy-rag.service.ts` | modify | 提供统一证据排序与共享受约束生成能力 | AC-03、AC-04 |
| `backend/src/rag/agentic/agentic-rag.service.ts` | modify | Agentic 汇合与生成复用统一证据能力 | AC-03、AC-04 |
| `backend/src/rag/karpathy/karpathy-rag.service.spec.ts` | modify | 覆盖 RRF／Rerank 顺序和统一生成 | AC-03、AC-04 |
| `backend/src/rag/agentic/agentic-rag.service.spec.ts` | modify | 覆盖 Agentic 复用排序与引用兜底 | AC-03、AC-04 |
| `backend/src/test/chat-modes.integration.spec.ts` | modify | 覆盖三模式输出契约一致性 | AC-03、AC-04、AC-05 |
| `docs/architecture/AGENT_PLATFORM_READINESS.md` | modify | 记录黄金集和证据一致性边界 | AC-01～AC-05 |
| `ROADMAP.md` | modify | 更新项目真实验证状态 | AC-01～AC-05 |
| `specs/045-golden-evidence-consistency/*` | add | 保存 Spec、Tasks、验证证据和状态 | AC-01～AC-05 |

## 执行顺序

1. 建立黄金集清单和离线校验／可选 live 回放脚本，先让覆盖门禁可执行。
2. 在 Karpathy 提供统一排序和固定证据生成能力，并补单测。
3. 修改 Agentic 汇合和生成节点，接入共享能力，补三模式集成测试。
4. 接入 CI 离线门禁，更新文档和 ROADMAP。
5. 执行构建、单测、离线黄金集、三链路确定性评测；依赖稳定时执行 live 回放，记录 Milvus 阻塞边界。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| golden | `cd backend && npm run eval:golden-business` | 84 条案例、六类覆盖和来源字段校验通过 |
| unit | `cd backend && npm test -- --runInBand src/rag/karpathy/karpathy-rag.service.spec.ts src/rag/agentic/agentic-rag.service.spec.ts` | 相关排序、生成和引用测试通过 |
| integration | `cd backend && npm test -- --runInBand src/test/chat-modes.integration.spec.ts` | 三模式入口契约通过 |
| build | `cd backend && npm run build` | 退出码为 0 |
| platform | `cd backend && npm run eval:agent-platform` | 既有路由、任务和产研门禁通过 |
| live | `cd backend && GOLDEN_EVAL_REQUIRE_LIVE=true npm run eval:golden-business` | 依赖可用时三模式报告均生成；依赖不可用时明确阻塞 |

## 执行控制

- 状态恢复：on
- 独立审查：off
- 分支策略：当前分支（不切换受保护的 `main`）
- 提交策略：phase

## 状态机注册

- 已注册 AC：AC-01、AC-02、AC-03、AC-04、AC-05
- 已注册任务：T001、T002、T003
- 状态文件：`specs/045-golden-evidence-consistency/state.json`

## 风险与回退

- 风险：黄金集 live 回放受 Milvus、LLM 或外部搜索可用性影响；只在依赖健康时解释 live 分数。
- 风险：统一生成能力可能改变 Agentic 的答案文本，但不会改变 Agentic 的规划、检索并发和审批边界。
- 回退方式：保留旧的 `totalScore` 排序分支和现有安全降级，若单测发现行为变化可按任务回退，不执行 Git 历史回滚。

## 审批

- Plan 状态：approved
- 批准人：主人
- 批准时间：2026-09-18
- 审批证据：本轮用户请求明确授权实现两项优化，范围与成功标准已锁定。
