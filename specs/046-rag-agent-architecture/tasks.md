# 任务清单：Evidence Policy 边界与基线审计

## T001：记录 P0 基线与架构审计

- 依赖：无
- 允许文件：`docs/README.md`、`docs/refactor/**`、`ROADMAP.md`、`specs/046-rag-agent-architecture/**`
- 操作：记录真实基线、当前模块/调用链、API/事件兼容性和目标架构；不得覆盖用户已有 ROADMAP diff。
- 对应 AC：AC-01、AC-04
- 验证：`git diff --check -- docs/README.md`
- 状态机验证命令：`add-task --command 'git diff --check -- docs/README.md'`
- 范围基线：`specs/046-rag-agent-architecture/scope-baseline-T001.json`
- 范围报告：`specs/046-rag-agent-architecture/scope-report-T001.json`
- 完成定义：P0 要求的审计文档存在；逐项对照 Git 状态、源码调用点和命令原始结果，并在状态机为 AC-01/AC-04 记录审阅证据。
- 状态：done

## T002：抽取共享 Evidence Policy 并保持兼容

- 依赖：T001
- 允许文件：`backend/src/rag/evidence/retrieval.types.ts`、`answer-quality.service.ts`、`deterministic-answer-builder.ts`、`evidence-policy.service.ts`、`evidence-policy.service.spec.ts`、`evidence.module.ts`、`evidence-bundle.ts`；`backend/src/rag/evidence/answer-quality.service.ts`、`deterministic-answer-builder.ts`、`rag.module.ts`、`rag.service.ts`、`rag.service.spec.ts`；`backend/src/rag/agentic/agentic-rag.module.ts`、`agentic-rag.service.ts`、`agentic-rag.service.spec.ts`；`specs/046-rag-agent-architecture/**`
- 操作：Evidence 算法迁入中立模块，旧路径 re-export/方法委托，Agentic 使用显式策略服务并移除可选方法探测。
- 对应 AC：AC-02、AC-03、AC-04
- 验证：`pnpm --dir backend exec jest --runInBand src/rag/evidence/evidence-policy.service.spec.ts src/rag/evidence/evidence-bundle.spec.ts src/rag/rag.service.spec.ts src/rag/agentic/agentic-rag.service.spec.ts`；`pnpm --dir backend run build`
- 状态机验证命令：对上述 Jest 与 build 命令分别调用 `add-task --command`。
- 范围基线：`specs/046-rag-agent-architecture/scope-baseline-T002.json`
- 范围报告：`specs/046-rag-agent-architecture/scope-report-T002.json`
- 完成定义：新增/相关测试和 build 通过；无 API/事件/权限/引用语义变化；旧 Facade 可继续调用。
- 状态：done

## T003：执行新 Evidence 文件的静态检查

- 依赖：T002
- 允许文件：`specs/046-rag-agent-architecture/**`
- 操作：对新增的 Evidence 类型、算法、策略服务、模块与策略测试执行 ESLint；全量 lint 的既有失败单独记录。
- 对应 AC：AC-04
- 验证：`pnpm --dir backend exec eslint src/rag/evidence/retrieval.types.ts src/rag/evidence/answer-quality.service.ts src/rag/evidence/deterministic-answer-builder.ts src/rag/evidence/evidence-policy.service.ts src/rag/evidence/evidence-policy.service.spec.ts src/rag/evidence/evidence.module.ts`
- 状态机验证命令：`add-task --command 'pnpm --dir backend exec eslint src/rag/evidence/retrieval.types.ts src/rag/evidence/answer-quality.service.ts src/rag/evidence/deterministic-answer-builder.ts src/rag/evidence/evidence-policy.service.ts src/rag/evidence/evidence-policy.service.spec.ts src/rag/evidence/evidence.module.ts'`
- 范围基线：`specs/046-rag-agent-architecture/scope-baseline-T003.json`
- 范围报告：`specs/046-rag-agent-architecture/scope-report-T003.json`
- 完成定义：新增 Evidence 文件 ESLint 通过。
- 状态：done

## T004：比较既有文件的 lint 基线

- 依赖：T003
- 允许文件：`specs/046-rag-agent-architecture/**`
- 操作：针对本计划涉及的全部 TypeScript 文件重跑 ESLint，与实施前保存的诊断基线比较；不要求清除既有错误。
- 对应 AC：AC-04
- 验证：`node specs/046-rag-agent-architecture/compare-eslint-baseline.mjs`
- 状态机验证命令：`add-task --command 'node specs/046-rag-agent-architecture/compare-eslint-baseline.mjs'`
- 范围基线：`specs/046-rag-agent-architecture/scope-baseline-T004.json`
- 范围报告：`specs/046-rag-agent-architecture/scope-report-T004.json`
- 完成定义：全部变更 TypeScript 文件相对 P0 基线没有新增 ESLint 诊断。
- 状态：done

## T005：检查 P0 文档格式与事实证据

- 依赖：T001
- 允许文件：`specs/046-rag-agent-architecture/**`
- 操作：检查 `docs/refactor/` 文档格式，并人工对照源码调用点、Git 状态和原始验证结果，记录 AC-01/AC-04 观察证据。
- 对应 AC：AC-01、AC-04
- 验证：`python3 -c 'from pathlib import Path; files=[*Path("docs/refactor").glob("*.md"),Path("docs/README.md")]; errors=[f"{p}:{i}" for p in files for i,line in enumerate(p.read_text(encoding="utf-8").splitlines(),1) if line.rstrip(" \\t") != line]; print("\\n".join(errors)); raise SystemExit(bool(errors))'`
- 状态机验证命令：`add-task --command 'python3 -c \'from pathlib import Path; files=[*Path("docs/refactor").glob("*.md"),Path("docs/README.md")]; errors=[f"{p}:{i}" for p in files for i,line in enumerate(p.read_text(encoding="utf-8").splitlines(),1) if line.rstrip(" \\\\t") != line]; print("\\\\n".join(errors)); raise SystemExit(bool(errors))\''`
- 范围基线：`specs/046-rag-agent-architecture/scope-baseline-T005.json`
- 范围报告：`specs/046-rag-agent-architecture/scope-report-T005.json`
- 完成定义：格式检查通过，且为 AC-01/AC-04 写入基于具体源码与命令结果的 observation。
- 状态：done
