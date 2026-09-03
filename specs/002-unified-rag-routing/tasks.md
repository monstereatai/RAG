# 任务清单：统一 RAG 路由与面试口径定稿

## T001：定稿规范与活跃面试材料

- 依赖：无
- 允许文件：`README.md`、`docs/architecture/ARCHITECTURE.md`、`docs/interview/功能步骤流程.md`、`docs/interview/README.md`、`docs/interview/interview-docs-usage.md`、`docs/interview/AI复盘四场面试问题与RAG项目回答.md`、`docs/interview/AI复盘四场面试问题与RAG项目回答-面试表达版.md`、`docs/interview/INTERVIEW_PLAYBOOK.md`
- 操作：统一三种模式、Karpathy、Auto 路由、无证据处理和审批口径。
- 对应 AC：AC-01、AC-05
- 验证：Mermaid 11.15 全图解析；目标文档 Diff 检查。
- 范围基线：`specs/002-unified-rag-routing/scope-baseline-T001.json`
- 范围报告：`specs/002-unified-rag-routing/scope-report-T001.json`
- 完成定义：唯一流程真源明确，活跃面试材料无冲突链路。
- 状态：pending
- 证据 ID：`T001-mermaid`

## T002：统一精确直答与 Simple

- 依赖：T001
- 允许文件：`backend/src/rag/karpathy/karpathy-rag.service.ts`、`backend/src/rag/karpathy/karpathy-rag.service.spec.ts`、`backend/src/modules/chat/chat.service.ts`
- 操作：公开受治理精确直答入口，Simple 未命中后走统一 Hybrid，无证据时联网或拒答。
- 对应 AC：AC-01、AC-02、AC-06
- 验证：`cd backend && npm test -- --runInBand src/rag/karpathy/karpathy-rag.service.spec.ts`
- 范围基线：`specs/002-unified-rag-routing/scope-baseline-T002.json`
- 范围报告：`specs/002-unified-rag-routing/scope-report-T002.json`
- 完成定义：Simple 行为和兼容测试通过。
- 状态：pending
- 证据 ID：`T002-unit`

## T003：修正 Auto 与 Agentic

- 依赖：T002
- 允许文件：`backend/src/rag/agentic/agentic-rag.service.ts`、`backend/src/rag/agentic/agentic-rag.service.spec.ts`
- 操作：Auto 前置直答、移除超长强制 Simple、移除无索引／无证据模型兜底并复用 Fast Path。
- 对应 AC：AC-03、AC-04、AC-06
- 验证：`cd backend && npm test -- --runInBand src/rag/agentic/agentic-rag.service.spec.ts`
- 范围基线：`specs/002-unified-rag-routing/scope-baseline-T003.json`
- 范围报告：`specs/002-unified-rag-routing/scope-report-T003.json`
- 完成定义：Auto／Agentic 路由和安全收口测试通过。
- 状态：pending
- 证据 ID：`T003-unit`

## T004：全量验证与进度定稿

- 依赖：T003
- 允许文件：`ROADMAP.md`
- 操作：运行定向回归、Lint、Build、文档冲突审计；验证通过后更新真实进度。
- 对应 AC：AC-01、AC-02、AC-03、AC-04、AC-05、AC-06
- 验证：定向双套件、ESLint、Build。
- 范围基线：`specs/002-unified-rag-routing/scope-baseline-T004.json`
- 范围报告：`specs/002-unified-rag-routing/scope-report-T004.json`
- 完成定义：全部命令通过，ROADMAP 仅记录已验证事实。
- 状态：pending
- 证据 ID：`T004-unit`、`T004-lint`、`T004-build`
