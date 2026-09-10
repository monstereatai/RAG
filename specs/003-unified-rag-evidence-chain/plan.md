# 实施计划：统一 RAG 证据链重构

## 已确认上下文

- 相关模块：`KarpathyRagService` 当前负责 Hybrid RAG、Rerank、上下文构建与回答；`AgenticRagService` 会再次按子问题检索、再做充分性判断；`QueryIntentRouter` 决定来源策略。
- 现有行为与约束：`RetrieveOptions.prefetchedFastPath` 已能传递初始检索快照，但不包含充分性结论；Agentic 会以子问题重新判定，导致原问题已命中仍被否决。
- 不确定项：真实外部 Rerank／LLM 的稳定性不属于本地代码可保证范围，因此实现必须在它们失败时使用同一证据包的确定性降级。

## 方案

- 数据流／状态流：
  1. Karpathy 检索后创建 `EvidenceBundle`：原始查询、统一排序后的片段、充分性结论、诊断、来源策略与每个可选子问题的证据映射。
  2. Simple／Auto 从 Bundle 生成回答；Agentic 接收同一 Bundle 并将其作为原始问题的权威结论，仅对真正拆分出的独立子问题追加证据。
  3. Web fallback 只由 Bundle 的来源策略与「本地证据未充分」共同授权；`local_only` 无条件跳过。
  4. 生成路径先做受引用 LLM 汇总；引用失败时输出带来源标识的结构化证据摘要，禁止裸片段回显。
- 接口或组件边界：保留 `RetrievedChunk`、`RetrieveOptions` 与现有 SSE 字段；在 `PrefetchedFastPath` 中增加 bundle，供 Agentic 和 Simple 兼容复用。
- 兼容性与回退：不删除旧公开方法；旧调用方未提供 bundle 时按现有检索构建一个。不会变更 API 请求格式或数据库。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `backend/src/rag/evidence/evidence-bundle.ts` | add | 定义统一证据包、充分性和来源策略不变量 | AC-01、AC-02、AC-05 |
| `backend/src/rag/evidence/evidence-bundle.spec.ts` | add | 单元验证证据包的充分性与本地来源约束 | AC-01、AC-02 |
| `backend/src/rag/karpathy/karpathy-rag.service.ts` | modify | 产出和消费 Bundle，统一生成与摘要降级 | AC-01、AC-03、AC-05 |
| `backend/src/rag/karpathy/karpathy-rag.service.spec.ts` | modify | 覆盖统一 Bundle 的回答与引用回退 | AC-01、AC-03 |
| `backend/src/rag/agentic/agentic-rag.service.ts` | modify | Agentic 复用原始 Bundle，追加独立子问题证据，收敛联网判断 | AC-01、AC-02、AC-05 |
| `backend/src/rag/agentic/agentic-rag.service.spec.ts` | modify | 覆盖预取证据不被子问题误拒和本地限制 | AC-01、AC-02 |
| `backend/src/rag/prompts/query-intent-router.ts` | modify | 移除生产路径固定关键词提示，保持结构化语义路由与安全默认 | AC-04 |
| `backend/src/rag/prompts/query-intent-router.spec.ts` | modify | 覆盖低置信度／解析失败与来源策略 | AC-02、AC-04 |
| `backend/eval/query-routing.dataset.json` | modify | 加入边界样本，固定路由回归集 | AC-04、AC-05 |
| `backend/scripts/eval-query-routing.mjs` | modify | 删除正则关键词伪评测，改为结构化路由契约校验 | AC-04、AC-05 |
| `ROADMAP.md` | modify | 仅在验证通过后记录真实进展 | AC-05 |
| `specs/003-unified-rag-evidence-chain/*` | add/modify | 受控过程工件与验证证据 | AC-01～AC-05 |

## 执行顺序

1. 建立证据包领域模型、单测与状态机证据。
2. 将 Karpathy Fast Path 改为构建／消费统一 Bundle，并收敛引用失败摘要。
3. 将 Agentic 变为 Bundle-first：对原问题不重复否决，只为显式独立子问题补证；联网由来源策略控制。
4. 收敛路由 Prompt 与评测集，移除生产 Prompt 中基于固定业务词的决策表达。
5. 执行定向测试、评测、构建和服务级回放，更新 Roadmap 与验证报告。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| unit | `pnpm --dir backend exec jest src/rag/evidence/evidence-bundle.spec.ts src/rag/prompts/query-intent-router.spec.ts --runInBand --env=/Users/monster/Documents/GitHub/code/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node/build/index.js` | 全部通过 |
| unit | `pnpm --dir backend exec jest src/rag/karpathy/karpathy-rag.service.spec.ts src/rag/agentic/agentic-rag.service.spec.ts --runInBand --env=/Users/monster/Documents/GitHub/code/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node/build/index.js` | 本次相关用例通过；既有失败单列说明 |
| eval | `pnpm --dir backend eval:query-routing` | 数据集全部满足来源策略预期 |
| build | `pnpm --dir backend run build` | 退出码为 0 |
| smoke | 以本地 SSE 请求重放「资料库当中，帮我总结李逵」 | 只使用本地证据、返回有引用的总结 |

## 执行控制

- 状态恢复：on
- 独立审查：off；当前会话未获授权委派独立审查 Agent，改由最终 Diff、范围门禁和自动化回归验证承担交付门禁。
- 分支策略：当前分支；`main` 为受保护分支，用户未授权切换分支。
- 提交策略：phase；用户此前明确要求先提交代码，本次每个稳定阶段可本地提交，但不会推送。

## 状态机注册

- 已注册 AC：AC-01、AC-02、AC-03、AC-04、AC-05
- 已注册任务：T001、T002、T003、T004、T005
- 状态文件：`specs/003-unified-rag-evidence-chain/state.json`

## 风险与回退

- 风险：共享 Bundle 如果截断候选，Agentic 多子问题可能需要增量检索；计划保留显式独立子问题的补证能力。
- 风险：当前 Jest 30 环境存在既有运行时初始化与 3 条 Karpathy 历史断言债务；使用已验证 Node 环境运行新测试，并对既有失败单列，不把它们伪装为本次失败。
- 回退方式：本次不改存储与接口；可按本地提交回退本阶段代码，用户运行时索引文件不受影响。

## 审批

- Plan 状态：approved
- 批准人：主人
- 批准时间：2026-09-10
- 审批证据：用户原始确认语句「可以，帮我全都重构掉」「用/goal模式重构，重构完毕才能停下」。
