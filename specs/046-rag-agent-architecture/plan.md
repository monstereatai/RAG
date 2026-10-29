# 实施计划：Evidence Policy 边界与基线审计

## 已确认上下文

- 当前 HEAD 为 `fb7d5dd9b8150667e563ea7017afb6a17c975d9b`；任务书列出的旧基线和文件行数已过期。
- `EvidenceBundle`、`AnswerQualityService`、`DeterministicAnswerBuilder` 已存在。Agentic 的动态方法探测主要位于 `agentic-rag.service.ts` 的 `rankEvidenceChunks`、`assessRetrievedChunks`、`buildEvidenceFirstAnswer` 三个适配函数；缺方法时会执行本地回退。
- Simple/Auto/Agentic 的统一 Chat 入口已由先前改造实现；文档队列、任务、媒体解析、权限和检索描述也已有独立组件。
- `specs/003-unified-rag-evidence-chain/tasks.md` 的五个任务均标记 done，但旧状态文件不受当前 workflow_state 脚本支持，且缺 `verify.md`；本阶段不改其历史状态。
- `specs/043-unified-chat-orchestration/state.json` 标记 executing，T002 仍 in_progress，后续任务涉及 Chat/AG-UI。当前阶段不碰这些 Chat 文件；P5 前先核验并吸收该规格的现有成果。
- 工作区已有 Obsidian 配置、流程文档、ROADMAP 和 BM25 索引修改。本阶段按现状保留；仅按计划增量更新 ROADMAP，不覆盖既有 diff。

## 方案

1. 创建 `docs/refactor/` 文档区并更新 Docs Index，记录当前真实基线、调用链、模块职责、API/SSE/AG-UI/MCP 契约和阶段边界。
2. 在 `backend/src/rag/evidence/` 建立中立类型和 Evidence Policy 服务；将现有 Answer Quality 与 Deterministic Answer Builder 实现迁入中立目录，原 Karpathy 路径保留为 re-export 兼容入口，不删除旧文件。
3. `KarpathyRagService` 继续暴露旧策略方法并委托给 Evidence Policy；`AgenticRagService` 直接注入 Evidence Policy，移除可选方法探测和不一致回退。
4. 使用定向单测、backend build 和 Diff/范围检查验证。全量 Jest/lint 已有失败作为基线，逐项区分本次新增问题。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `docs/README.md` | modify | 登记新的架构重构证据文档目录 | AC-01 |
| `docs/refactor/00-baseline.md` | add | 当前 HEAD、脏工作区和真实构建/测试/lint 结果 | AC-01、AC-04 |
| `docs/refactor/01-module-audit.md` | add | 入口、依赖、职责、状态、重复点、风险和迁移建议 | AC-01 |
| `docs/refactor/02-target-architecture.md` | add | 现状到目标边界与切片依赖 | AC-01 |
| `docs/refactor/03-api-and-event-compatibility.md` | add | 记录 HTTP、SSE/AG-UI、DTO 与 MCP 对外边界 | AC-01、AC-03 |
| `docs/refactor/04-test-and-evaluation.md` | add | 记录基线和本阶段验证证据 | AC-01、AC-04 |
| `docs/refactor/05-migration-and-rollback.md` | add | 记录无 Schema 变更的兼容/回退策略和审批边界 | AC-01、AC-03 |
| `docs/refactor/blocked-validation.md` | add | 记录未运行的真实入口、外部依赖和权限缺口 | AC-01、AC-04 |
| `docs/refactor/progress.md` | add | 按任务书格式记录 P0/P1a 实际进度 | AC-01、AC-04 |
| `ROADMAP.md` | modify | 同步 P0/P1a 的真实状态，保留现有未提交内容 | AC-01、AC-04 |
| `backend/src/rag/evidence/retrieval.types.ts` | add | 将共享候选/诊断契约从实现 Service 中立化 | AC-02 |
| `backend/src/rag/evidence/answer-quality.service.ts` | add | 证据充分性与引用支持实现迁入 Evidence 层 | AC-02 |
| `backend/src/rag/evidence/deterministic-answer-builder.ts` | add | 证据优先摘要实现迁入 Evidence 层 | AC-02 |
| `backend/src/rag/evidence/evidence-policy.service.ts` | add | 为排序、充分性和摘要提供单一显式策略入口 | AC-02 |
| `backend/src/rag/evidence/evidence-policy.service.spec.ts` | add | 固定分数顺序、附件充分性、引用和摘要语义 | AC-02、AC-03 |
| `backend/src/rag/evidence/evidence.module.ts` | add | 注册并导出共享 Evidence providers | AC-02 |
| `backend/src/rag/evidence/evidence-bundle.ts` | modify | 改从中立 Evidence 类型导入，不依赖 Karpathy 实现 | AC-02 |
| `backend/src/rag/karpathy/answer-quality.service.ts` | modify | 保留旧路径的 re-export 兼容入口 | AC-02 |
| `backend/src/rag/karpathy/deterministic-answer-builder.ts` | modify | 保留旧路径的 re-export 兼容入口 | AC-02 |
| `backend/src/rag/karpathy/karpathy-rag.module.ts` | modify | 引入 Evidence Module 并维持既有导出 | AC-02、AC-03 |
| `backend/src/rag/karpathy/karpathy-rag.service.ts` | modify | 从 Evidence Policy 取共享类型/策略，旧方法委托兼容 | AC-02、AC-03 |
| `backend/src/rag/karpathy/karpathy-rag.service.spec.ts` | modify | 回归旧 Facade 结果和分数语义 | AC-02、AC-03 |
| `backend/src/rag/agentic/agentic-rag.module.ts` | modify | 注入 Evidence Module | AC-02 |
| `backend/src/rag/agentic/agentic-rag.service.ts` | modify | 删除动态方法探测/差异化回退，改用显式策略依赖 | AC-02、AC-03 |
| `backend/src/rag/agentic/agentic-rag.service.spec.ts` | modify | 验证 Agentic 使用共享策略且保持现有状态机行为 | AC-02、AC-03 |
| `specs/046-rag-agent-architecture/eslint-baseline.json` | add | 保存 9 个既有文件的 90 条 ESLint 基线诊断 | AC-04 |
| `specs/046-rag-agent-architecture/compare-eslint-baseline.mjs` | add | 对全部变更 TypeScript 文件比较新增 ESLint 诊断 | AC-04 |
| `specs/046-rag-agent-architecture/**` | add/modify | 保存路线图、受控流程和验证证据 | AC-01、AC-04 |

## 执行顺序

1. 计划批准后在当前 HEAD 创建 `refactor/rag-agent-architecture`，保留并随分支携带现有未提交工作区修改；不 stash、不 reset、不 clean。
2. 完成 P0 基线、模块审计、契约清单和目标边界文档；只在此后开始业务代码改动。
3. 先迁移证据类型和算法实现，再注册 Evidence Module；保持旧路径兼容，不删除文件。
4. Karpathy 旧方法改为委托；Agentic 注入共享策略并移除本地回退；更新定向测试。
5. lint 新增 Evidence 文件，并对所有变更 TypeScript 文件运行基线差异检查。
6. 检查 P0 文档格式、Diff、作用范围和兼容性；记录到 `docs/refactor/progress.md`、`ROADMAP.md` 与 `verify.md`。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| baseline build | `pnpm build` | 已记录当前全仓通过；实施后 backend build 再通过 |
| unit | `pnpm --dir backend exec jest --runInBand src/rag/evidence/evidence-policy.service.spec.ts src/rag/evidence/evidence-bundle.spec.ts src/rag/karpathy/karpathy-rag.service.spec.ts src/rag/agentic/agentic-rag.service.spec.ts` | 本阶段新增/相关用例通过；预先存在的失败单列 |
| build | `pnpm --dir backend run build` | 退出码为 0 |
| new-file lint | `pnpm --dir backend exec eslint src/rag/evidence/retrieval.types.ts src/rag/evidence/answer-quality.service.ts src/rag/evidence/deterministic-answer-builder.ts src/rag/evidence/evidence-policy.service.ts src/rag/evidence/evidence-policy.service.spec.ts src/rag/evidence/evidence.module.ts` | 新增 Evidence 文件通过 |
| lint delta | `node specs/046-rag-agent-architecture/compare-eslint-baseline.mjs` | 所有变更 TypeScript 文件没有新增 ESLint 诊断 |
| docs format | `python3 -c 'from pathlib import Path; files=[*Path("docs/refactor").glob("*.md"),Path("docs/README.md")]; errors=[f"{p}:{i}" for p in files for i,line in enumerate(p.read_text(encoding="utf-8").splitlines(),1) if line.rstrip(" \\t") != line]; print("\\n".join(errors)); raise SystemExit(bool(errors))'` | 新增文档与 Docs Index 无行尾空格 |
| docs/diff | `git diff --check -- docs/README.md` | Docs Index 无空白错误；新增文档和 ROADMAP 通过源码/原始命令对照记录人工审阅证据 |
| mode replay | 管理后台登录后分别执行 simple、auto、agentic 同一问题 | 核对答案、路由、引用和检索状态；环境不可用时记为 blocked，不伪造通过 |

## 执行控制

- 状态恢复：on
- 独立审查：plan（只审查本计划，不修改计划或代码）
- 分支策略：批准后按任务书创建 `refactor/rag-agent-architecture`
- 提交策略：none

## 状态机注册

- 已注册 AC：AC-01 至 AC-04
- 已注册任务：T001、T002、T003、T004、T005
- 状态文件：`specs/046-rag-agent-architecture/state.json`

## 风险与回退

- 风险：既有全量 Jest 和 lint 基线失败；相关测试可能需要区分旧失败与本次回归。
- 风险：`specs/043` 尚有未完成的过程状态；本阶段不改 Chat/AG-UI 文件，后续接触前重核。
- 风险：真实三模式 UI 回放需要本地服务、数据库、用户会话和模型配置；缺少时记为 blocked。
- 回退方式：不执行 Git 回滚；保留旧服务方法/类型路径并由兼容委托维持行为。需要回滚时由用户另行批准。

## 审批

- Plan 状态：approved
- 批准人：monstereat
- 批准时间：2026-10-29
