# 课程调整验证记录

日期：2026-09-04。范围：课程材料、实验命令与现有测试；没有部署或修改业务运行代码。

| 验证 | 实际结果 | 证据范围 |
| --- | --- | --- |
| 切片参考答案 | 3／3 通过 | 基础算法实验 |
| BM25 参考答案 | 3／3 通过 | 当前去重词项简化实现 |
| Agent Loop 参考答案 | 3／3 通过 | 预算、阻断、成功后快照时机 |
| 六个工程测试文件 | 21／23 通过，2 项失败 | 本地替身依赖下的模型、工具、评测与工作流分支 |
| eval:agent-tasks | 退出码 0，8 例，simulated=true（模拟数据） | 读取结果文件计算指标，没有执行真实 Agent |
| eval:production-workflow | 退出码 0，10 例，simulated=true | 同上，不能用来抵消工作流单测失败 |

工程测试通过的文件：工具执行、工具策略、模型网关策略、Qwen 提供方、语义评测。工作流测试中的审批推进与驳回修订两例报错：`this.artifacts.markReviewState is not a function`。

已核对原因：`production-workflow.service.spec.ts` 的产物服务替身仅有 `create`，实际审批路径调用 `markReviewState`。这是当前测试与实现契约不一致，不足以认定真实产物服务缺方法；也不能据此宣称审批运行已通过。后续修复应同步替身和审批状态断言，再重跑相关用例。

真实 Redis 重启恢复、并发写入、联网模型、四组检索与测试环境部署：本轮未执行，属于学员工程实验与后续联调范围。课程如实记录当前缺口，见 [实现边界](./IMPLEMENTATION-NOTES.md)。

复现命令见 [AI 应用实验](./LABS.md) 与 [Agent 实验](../course-agent/LABS.md)；参考答案将命令末尾的 `student`（学员版）改为 `solution`（参考版）。
