# Plan 独立复审：产研运工作流启动与流转可靠性

## P0：阻塞问题

- 无。上一轮审批通知故障窗口已由“终态早退前补齐缺失通知意图 + 定时扫描待审批 Run 并按稳定键 ensure”覆盖；质量修复与人工驳回 revision 也已分别规定 auto 策略与强制复核。

## P1：需处理或明确接受的问题

- 无。

## P2：非阻塞优化

- 无。

## 上轮问题复核

| 上轮问题 | 复审结果 | 依据 |
| --- | --- | --- |
| P0：checkpoint 后、通知 Outbox 前 Worker 退出可能漏通知 | 已解决 | Plan §方案“审批通知”规定终态早退前补意图并由定时对账扫描；T003 完成定义覆盖该强杀窗口和 Outbox 暂不可用。 |
| P0：quality revision 与 human rejection revision 复用强制审批分支 | 已解决 | Plan §方案“质量判定”和 T001 分别规定质量修复遵循原策略、人工驳回后仍强制复核，并要求两类用例。 |
| P1：唯一键冲突后在 aborted transaction 内读 Outbox | 已解决 | Plan 明确异常先冒泡并回滚，再由事务外基础 repository 读取；T002/T007 登记真实 PostgreSQL 验证，数据库不可用时 AC-02 不验收。 |
| P1：Send 并行节点写共享标量状态 | 已解决 | Plan §方案“同层并行”和 T004 指定按岗位键控的输入、结果、错误状态，禁止并行写共享游标标量。 |
| P1：Run/Task 事件及 Goal 在事务和重启边界不可靠 | 已解决 | Plan §方案“运行事件与 Goal”、T002 操作与完成定义规定事务内不发事件、提交后幂等补发，恢复时补齐 Goal。 |
| P1：质量修订入口与 Admin 文件范围不一致 | 已解决 | Plan 明确复用现有 workflow detail `requiresRevision` 行为且不改详情页文件；T005 操作与白名单一致。 |
| P1：Plan、Tasks、state 文件白名单不一致 | 已解决 | 静态逐路径核对：Plan 文件清单 29 项与 Tasks 并集、state 并集一致；T001–T008 每个 Task 与 state 的 `allowed_paths` 也一致。 |
| 后续发现：T007 可能在最终 build/lint 后修改后端代码 | 已解决 | T008 依赖 T007，且重跑 build、lint、Admin lint、antd lint、diff；三份工件均登记 T008。 |
| 后续发现：T002 活跃 Run 查询在 T003 前缺少测试门禁 | 已解决 | T002 完成定义要求 `production-workflow.service.spec.ts` 覆盖 route/status 过滤与恢复候选，且该文件在 Tasks/state 的 T002 白名单中；T002 已登记并会运行该 spec，早于依赖它的 T003。当前实现阶段需新增该用例；本次只审查计划，没有运行测试。 |

## 结论

- 状态：pass
- 审查范围：修订后的 `plan.md`、`tasks.md`、`state.json` 与上一轮问题清单；只读复审，未运行测试。
- 审查人：独立审查者
