# Agent 工程实验

复用当前项目、现有单测和岗位功能。所有命令从仓库根目录执行；单测使用替身依赖，真实 Redis（缓存数据库）与模型联调分别验收。

## 实验 A：工具幂等与结果未知

入口：[ToolExecutionService](../backend/src/tools/tool-execution.service.ts)、[现有单测](../backend/src/tools/tool-execution.service.spec.ts)。

```bash
pnpm --dir backend exec jest --config ../course/jest.engineering.config.json --runTestsByPath src/tools/tool-execution.service.spec.ts src/tools/tool-execution-policy.service.spec.ts --runInBand
```

先观察现有用例覆盖：审计顺序、未审批阻断、复用已完成结果。它们没有证明所有并发和故障场景。

用测试写工具计数器继续构造：
1. 相同操作身份串行调用两次：计数只增加一次，第二次复用结果。
2. 第一次调用用可控 Promise（异步结果）挂起，第二次并发进入：共享幂等状态下第二次不执行写动作。
3. 工具先增加计数，再模拟响应丢失：状态应记录结果未知；再次调用不能盲目写入。
4. 从业务计数或业务操作 ID 查询确认后，选择恢复结果或明确的补偿流程。
5. 模拟幂等记录过期：记录当前实现是否允许重复，解释远端幂等和操作身份如何保护迟到重试。

学员在学习工作副本补用例与断言；若当前行为不满足目标，标记失败并提交最小修复与回归。不得把 TTL（过期时间）自动等同于用户新意图。

验收：提交真实计数、执行状态、审计顺序与失败解释。测试替身的锁行为还需在测试 Redis 上复核，不能把单进程结果当跨实例保证。

## 实验 B：审批、修订与恢复

主入口是生产工作流，不是 Chat（问答）审批事件。先读 [已知差异](../course/IMPLEMENTATION-NOTES.md)。

```bash
pnpm --dir backend exec jest --config ../course/jest.engineering.config.json --runTestsByPath src/modules/workflow/production-workflow.service.spec.ts --runInBand
```

现有测试包含显式审批推进、驳回后修订、局部重跑与所有者隔离。2026-09-04 实跑其中两项失败：产物服务测试替身缺少 `markReviewState`，见 [验证记录](../course/VERIFICATION.md)。这两项当前不能计为通过。真实接口按 [操作说明](../docs/PRODUCTION_WORKFLOW_USAGE.md) 执行：
1. 在已有 Agent 工作流页面创建测试任务，选产品、后端、测试岗位及必审策略；保存 threadId（任务标识）。
2. 查询到 pending_approval（待审批），记录产物版本与工具调用。此时下一批岗位不得提前执行。当前生产流程是在批次结果后审批，不等同于批准每个写工具。
3. 批准进入下一批；对中间岗位驳回，确认 revision_required（待修订），补充材料后局部重跑。
4. 在另一测试任务的待审批状态重启个人测试后端，查询同一标识后再审批，核对已完成结果保留。
5. 使用用户 B 访问用户 A 的任务、重复提交同一次审批，记录权限和重复推进行为。

HTTP（接口）入口以 `workflow.controller.ts` 为准：`/api/v1/workflows/production`，任务下的 `resume`（审批继续）与 `revise`（修订重跑）；鉴权使用当前测试用户，接口响应后轮询到稳定状态。

验收：事件、业务状态、调用次数共同证明恢复。Chat 审批只作为缺陷诊断练习：检查 pending 后是否仍有反思调用，不宣称其已暂停。重启恢复或重复审批未通过时，如实保留失败证据。

## 实验 C：任务级评测与一次修复

```bash
pnpm --dir backend exec jest --config ../course/jest.engineering.config.json --runTestsByPath src/modules/agent-evals/agent-eval.service.spec.ts --runInBand
pnpm --dir backend run eval:agent-tasks
pnpm --dir backend run eval:production-workflow
```

后两个命令仅计算已有数据文件的指标，不实际执行 Agent。按 [任务评测](./08-eval-ops/TASK-EVALUATION.md) 的六类任务独立采集运行记录，再做指标计算。成本、耗时与次数读取日志或提供方用量，标明估算字段。

至少构造一例答案正确但业务产物缺失，以及一例攻击请求被正确阻断。语义裁判不能决定“数据库已经写入”或“没有重复执行”。

验收：失败分类 → 轨迹定位 → 最小修改 → 六组回归，报告必须关联业务状态与运行标识。

## 基础循环实验

```bash
pnpm --dir backend exec jest --config ../course-agent/04-agent-loop/lab/jest.inplace.config.json agent-loop.student --runInBand
```

完成预算前置、阻断终止与成功后快照三个修复；再按 [规划讲义](./04-agent-loop/PLANNING.md) 增加无进展与重规划输入。这是循环机制练习，不能用三个单测证明完整恢复或生产可靠性。
