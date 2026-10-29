# 路线图：RAG + Agent 平台渐进式架构重构

## 目标

在现有 NestJS/TypeScript 仓库内分批收敛 RAG、入库、Context、Agent Runtime、Chat 与运营 API 边界。保留现有业务能力和外部契约，不通过大规模搬文件、重写服务或新增平台框架制造表面拆分。

## 当前事实

- 当前基线：`main`，HEAD `fb7d5dd9b8150667e563ea7017afb6a17c975d9b`（2026-10-25）。任务书给出的 2026-09-23 基线已过期。
- 当前工作区有用户未提交改动：`.obsidian/community-plugins.json`、`.obsidian/workspace.json`、`ROADMAP.md`、`docs/interview/功能步骤流程.md`、`workspace/bm25-index.json`，以及两个 Obsidian 插件目录。重构需保留这些改动。
- 仓库已有统一 `EvidenceBundle`、QueryPlan、HTTP/SSE/AG-UI 共用 Chat 执行入口、文档队列/任务/媒体处理组件；这些能力已在既有规格或当前代码中出现，不应重新实现。
- 仍能确认的边界问题：Agentic RAG 对 `KarpathyRagService` 存在动态可选方法探测；`DocumentService` 仍直接协调多种索引与补偿；`RequestContext` 放在 Chat 目录但被 RAG 模块引用。

## 交付切片

| 切片 | 内容 | 依赖 | 验收目标 | 状态 |
| --- | --- | --- | --- | --- |
| P0 | 当前调用链、模块盘点、契约与构建/测试/lint 基线 | 无 | 文档记录真实 HEAD、现有脏工作区、已实现能力和遗留债务 | 审计已完成；文档待计划批准 |
| P1a | 抽出共享 Evidence Policy；Karpathy 保留兼容 Facade；Agentic 去掉可选方法探测 | P0 | 排序、充分性、证据优先摘要来自一个显式类型契约，模式和回答行为不变 | 待执行 |
| P1b | 将 Agentic 生成/引用校验对 Karpathy 的直接依赖改为稳定生成契约 | P1a | Agent 编排依赖 RAG 能力接口，不持有 Simple RAG 实现细节 | 待单独审计与计划 |
| P2 | 收敛文档解析、索引写入与失败补偿边界，复用现有队列、任务、权限和媒体组件 | P0 | Document 用例入口变薄；版本、ACL、索引、补偿行为保持兼容 | 待单独审计与计划 |
| P3 | 将共享请求/检索 Context 契约迁出 Chat 模块；核实 Context 各来源与预算职责 | P0、P1 | RAG 不依赖 Chat 内部类型；历史、Memory、证据和 Artifact 来源边界可追溯 | 待单独审计与计划 |
| P4 | 审计 Agent Loop、Runtime Plan、Run、Task、Workflow、Checkpoint、Event 和 Artifact 权威 | P0、P3 | 只消除有证据的重复，不合并职责不同的运行状态 | 待单独审计与计划 |
| P5 | 基于现有统一 Chat 入口梳理剩余编排、运营 API 与 Trace 关联 | P1b、P3、P4 | API、DTO、SSE/AG-UI 顺序和后台查询兼容 | 待单独审计与计划 |
| P6 | 三模式回归、权限/版本/引用/恢复验证、文档与发布风险收口 | P1-P5 | 所有结论有可复现证据；真实环境缺口标为 blocked | 待执行 |

## 已知基线

- `pnpm build`：通过，覆盖 backend、admin-backend、frontend、admin、rag-cli 和 MCP server。
- `pnpm --dir backend exec jest --runInBand`：107 个 suite 中 94 通过、13 失败；556 项测试中 513 通过、43 失败。失败包括 RAG、DomainEvents、Admin 图片权限和 Conversation Embedding 等既有用例；具体失败不在本次重构前臆测修复。
- 全量 lint：未通过。backend 有 1,011 个 error、30 个 warning；admin 有 6 个 error、21 个 warning；admin-backend 0 error、2 warning；frontend 通过。后续按变更文件比较新增诊断，不清理无关技术债。
- P1a 涉及的 9 个既有 Evidence/Karpathy/Agentic 文件定向 ESLint 基线：90 个 error、0 warning，原始诊断快照保存在 `specs/046-rag-agent-architecture/eslint-baseline.json`；不得将其标为本次新增问题。
- 三模式真实 UI、外部 Provider、Docker 联调和质量评测未在基线阶段运行；运行前先检查环境与费用/写入边界。

## 约束与执行规则

- 按 P0→P1→P2→P3→P4→P5→P6 推进；每个架构切片先形成具体文件清单与验证命令，再实施。
- 不改 API/DTO、SSE/AG-UI 事件契约、ACL、生命周期、答案引用语义、数据库 Schema、迁移、`.env`、CI/CD 或生产部署。
- 不删除旧 Service 或文件；旧入口优先保留兼容 Facade。真正删除需另行取得明确批准。
- 当前文档为第一阶段路线图，不表示 P1-P6 已实现或验证。


## 执行授权与状态更新（2026-10-29）

主人后续指令“不要写 plan 直接修改”“批准执行所有计划”覆盖 P0–P6 实施；之后指令“测试不是很重要，先实现功能先”要求优先代码。原 P1a-only state/tasks 白名单不足以描述并行扩大范围，保留为历史门禁记录；实际已实施/未验证/待确认事项以 docs/refactor/progress.md 与 ROADMAP.md 为准。没有把原计划自动标成全部通过或人工验收。后续不需要重复询问已授权的结构重构。
