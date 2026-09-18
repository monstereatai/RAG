# 实施计划：高级 Agent 平台能力补齐

## 已确认上下文

- 现有 `AgentLoopService` 已有预算、超时、工具策略、Redis checkpoint 和恢复，但缺少统一取消入口及持久化取消状态。
- 现有 `AgentRunsService`、`agent_runs`、`agent_runtime_events` 和 Run Center 已存在，优先增量增强，不重新造运行中心。
- 现有评测脚本默认项目评测只跑 `simple,auto`，需要把 `agentic` 纳入默认门禁，并增加统一三模式门禁命令。
- 现有 Tracing 默认只保留内存中的 200 个 span，需要增加数据库持久化，同时保留无数据库时的本地降级。
- 现有质量 Gate 已存在，但没有明确运行恢复专项和三模式合同检查。

## 方案

### S1：Runtime 和恢复

1. 为 Agent Run 增加取消时间、取消原因和最后检查点时间字段。
2. `AgentRunsService` 增加幂等取消、终态保护和审计事件；Agent Ops 增加取消接口。
3. `AgentLoopService` 每轮执行前检查 Redis 取消标记，安全结束为 `cancelled`，不自动重放未知副作用。
4. 增加 Runtime／恢复／取消的单元测试和数据库迁移。

### S2：审批安全

1. 为审批恢复和驳回局部重跑补充未知副作用、重复批准、重复驳回和预算保持测试。
2. 复用现有 ToolExecution 的 `completed／running／unknown` 幂等状态，禁止未知结果自动重放。
3. 将运行、审批、恢复和局部重跑事件纳入统一 Runtime Event 指标。

### S3：评测与 CI 门禁

1. `eval-rag-project`、`eval-rag-e2e` 和业务证据采集脚本默认覆盖 `simple,auto,agentic`。
2. 新增 `eval:agent-platform`，校验三模式、查询路由、RAG 质量、Agent 任务、生产工作流和运行恢复合同。
3. CI 增加定向单测、三模式合同门禁和可配置的真实接口评测；没有外部密钥时只运行确定性门禁，不伪造真实生产结果。

### S4：可观测性

1. 新增 `trace_spans` 表和 TypeORM Entity；TracingService 异步持久化 HTTP／Agent Node span。
2. Tracing 查询优先读取持久化 span，数据库不可用时回退内存缓存。
3. 增加 Agent Run、取消、审批、恢复、评测门禁和检索失败指标。
4. 增加 Prometheus 告警规则和 Grafana Dashboard JSON 模板，不写入真实部署地址和密钥。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `backend/src/providers/db/entities/agent-run.entity.ts` | modify | 保存取消和检查点状态 | AC-01、AC-02 |
| `backend/src/migrations/1787800000000-AddAgentRuntimeControls.ts` | add | 为运行控制增加可回滚 schema | AC-01 |
| `backend/src/modules/agent-runs/agent-runs.service.ts` | modify | 取消、终态保护和审计 | AC-01、AC-02 |
| `backend/src/modules/agent-ops-admin/agent-ops-admin.controller.ts` | modify | 暴露取消运行接口 | AC-01 |
| `backend/src/modules/agent-loop/agent-loop.types.ts` | modify | 增加 cancelled 终态 | AC-01 |
| `backend/src/modules/agent-loop/agent-loop.service.ts` | modify | 每轮检查取消标记 | AC-01、AC-02 |
| `backend/src/modules/agent-loop/agent-loop.service.spec.ts` | modify | 运行恢复与取消回归 | AC-01、AC-02 |
| `backend/src/modules/agent-runs/agent-runs.service.spec.ts` | add | 运行状态与取消单测 | AC-01、AC-02 |
| `backend/src/providers/db/entities/trace-span.entity.ts` | add | 持久化 Trace span | AC-04 |
| `backend/src/migrations/1787900000000-AddTraceSpans.ts` | add | 创建 Trace 持久化表 | AC-04 |
| `backend/src/providers/db/typeorm.config.ts` | modify | 注册 Trace Entity | AC-04 |
| `backend/src/providers/db/database.module.ts` | modify | 注册运行时 Entity | AC-04 |
| `backend/src/modules/tracing/tracing.module.ts` | modify | 注入 Trace Repository | AC-04 |
| `backend/src/modules/tracing/tracing.service.ts` | modify | 持久化和内存降级 | AC-04 |
| `backend/src/modules/tracing/tracing.controller.ts` | modify | 查询持久化 Trace | AC-04 |
| `backend/src/modules/tracing/tracing.service.spec.ts` | modify | Trace 持久化降级测试 | AC-04 |
| `backend/src/modules/metrics/metrics.service.ts` | modify | 补充运行控制指标 | AC-04 |
| `backend/scripts/eval-rag-project.mjs` | modify | 默认纳入 Agentic | AC-03 |
| `backend/scripts/eval-rag-e2e.mjs` | modify | 默认纳入 Agentic | AC-03 |
| `backend/scripts/collect-business-rag-evidence.mjs` | modify | 三模式证据采集 | AC-03 |
| `backend/scripts/eval-agent-platform.mjs` | add | 统一三链路和平台门禁 | AC-03、AC-05 |
| `backend/package.json` | modify | 注册统一评测命令 | AC-03、AC-05 |
| `.github/workflows/quality-gate.yml` | modify | 接入 CI 质量门禁 | AC-05 |
| `docker/monitoring/prometheus/alerts.yml` | add | 运行与质量告警模板 | AC-04 |
| `docker/monitoring/grafana/rag-agent-overview.json` | add | 运行看板模板 | AC-04 |
| `docs/architecture/AGENT_PLATFORM_READINESS.md` | add | 记录能力和生产边界 | AC-06 |
| `ROADMAP.md` | modify | 记录实现和验证证据 | AC-06 |
| `specs/044-senior-agent-platform/verify.md` | add | 验证记录 | AC-01～AC-06 |

## 执行顺序

1. S1 Runtime 控制和迁移，先补取消／恢复契约。
2. S2 审批恢复回归测试，确认不破坏已有流程。
3. S3 三模式评测和 CI 门禁。
4. S4 Trace 持久化、指标、看板和告警模板。
5. 运行全量验证，更新文档和 ROADMAP。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| 单测 | `cd backend && npm test -- --runInBand src/modules/agent-loop/agent-loop.service.spec.ts src/modules/agent-runs/agent-runs.service.spec.ts src/modules/tracing/tracing.service.spec.ts` | 全部通过 |
| RAG 回归 | `cd backend && npm test -- --runInBand src/test/chat-modes.integration.spec.ts` | Simple／Auto／Agentic 均通过 |
| 三模式合同 | `cd backend && npm run eval:agent-platform` | 退出码为 0 |
| 构建 | `cd backend && npm run build` | 退出码为 0 |
| 迁移 | `cd backend && npm run migration:show` | 新迁移可识别且顺序正确 |
| Diff | `git diff --check` | 无空白错误 |
| 真实入口 | 后台同等接口分别执行 Simple、Auto、Agentic | 核对答案、路由、引用、检索状态 |

## 执行控制

- 状态恢复：on
- 独立审查：off（主人要求直接执行；由本轮验证记录保留证据）
- 分支策略：当前 `main`，不自动切换分支
- 提交策略：none，除非主人后续明确要求提交

## 风险与回退

- migration 失败：先停止服务变更，使用对应 `migration:revert` 回退新增 schema，再恢复应用版本。
- Trace DB 不可用：保留内存 span 和 Runtime Event，不阻塞问答。
- 评测服务不可用：确定性评测仍必须执行；真实接口评测报告标记 skipped，不伪造通过。
- Runtime 取消标记不可用：数据库状态仍写入 cancelled，当前轮在安全边界结束。
