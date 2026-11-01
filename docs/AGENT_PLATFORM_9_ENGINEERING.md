# Agent 平台工程补强（代码增量，不是生产环境 9 分认证）

基线：`monstereatai/RAG@ec26e0ad14f1317de47926633ca9651ff04c36b5`。本补丁继续复用现有 `DomainEventsService`/PostgreSQL `domain_event_outbox`、BullMQ、Redis Checkpointer，不添加平行消息系统。

## 改造点

1. `workflow.dispatch.requested` 持久事件：Workflow API 先把确定性 Job ID、tenant/thread 身份和工作流请求写入 PG Outbox；**由现有 DomainEvents dispatcher 投递 BullMQ**，失败按已有 Outbox 机制重试。队列不可用不会在 Redis 之外丢掉这条已经持久化的投递请求。已注册的专用 handler 对 tenant/thread/job 进行校验，避免内部事件落到 webhook 订阅者。
2. Worker 角色可配置：`WORKFLOW_PROCESSOR_ENABLED=false` 时进程只负责 HTTP/业务服务和排队，不消费此队列；独立 Worker 进程设置 `true`。`WORKFLOW_QUEUE_CONCURRENCY=1..16` 控制单实例处理并发。默认仍启用 Worker、并发为 1，保持现有行为。**这只是运行角色切换，不意味着已经实现独立的轻量 Worker bootstrap 或租户公平配额**。
3. Redis Checkpoint Lua 在写入前检查 latest 指针与 index 的类型及一致性，避免 `ZADD` 因已有错误键类型失败时留下半写入的状态。新增 `smoke:checkpoint:atomic-guard` 供独立可销毁 Redis 做真实异常注入；生产仍需备份及并发覆盖测试。
4. CI 修复管理端旧路由并增加已有专项单元测试。**真实 Golden 发布门禁仅能在配置了人工审核/真实 Run 的隔离或发布环境执行**，不能在无数据的 PR 构建里宣称合格。

## 重要的未完成风险与下一步

- **Run/Task 与 Outbox 当前尚不是同一个数据库事务**：`startAsync` 在 `ensureRun/initializeTasks` 后持久化 outbox。进程若恰好崩溃在两者之间，仍可能出现有 Run/Task 但没有 dispatch intent 的孤儿记录。要达到真正 9 分应将这三者纳入同一 PG 事务（涉及 `AgentRunsService`、`AgentTasksService` 依赖重构），并用真实崩溃注入证明。此补丁不虚称已完成。
- DomainEvents 出站事件**至少一次投递**；stable BullMQ jobId 只在作业仍保留于队列时去重。重放安全最终必须由 Worker 的 checkpoint/业务 CAS 和外部工具幂等保证。不要手工重试状态为 `unknown` 的工具；Worker 进程崩溃、Redis 数据丢失等需隔离环境验证。
- Pending outbox 有最多 16 次尝试上限；超过后需人工审核并显式 retry；不可无限静默重试。
- Outbox 存储可能含业务请求原文；必须按租户授权控制读取、加密数据库备份、清理保存期限，不要写入未授权公开仓库或日志。
- 横向扩容并不等于性能线性提升；正式验证需至少 2 个独立 Worker 实例、限流、租户配额、CPU/内存、模型 RPM/TPM 和完整负载报告。
- 真实 Golden Dataset 必须由授权业务资料、独立标注与真实运行记录组成；当前合成示例不能算生产数据。

## 本地流程

```bash
# 仓库根目录
python3 agent_platform_9_patch/apply.py --check
python3 agent_platform_9_patch/apply.py
pnpm --filter backend build
pnpm --filter backend exec jest --runInBand workflow-dispatch-contract.spec.ts redis-checkpointer.atomic.spec.ts
pnpm --dir apps/rag-api run test:hardening
git diff --check
```

部署需先完成 PostgreSQL 现有 `domain_event_outbox` migration，并保证 `DomainEventsService` dispatcher 正常运行。新事件的处理器是在 Workflow 模块启动时注册，已有 dispatcher 若先读事件会保留重试状态而非跳过。

隔离多 Worker 角色示例（不要同时让默认 API 进程抢队列）：

```bash
# API 进程
WORKFLOW_PROCESSOR_ENABLED=false pnpm --filter backend start:prod
# 第 1、第 2 个执行进程（各自独立，需配置相同的 PG/Redis 凭据）
WORKFLOW_PROCESSOR_ENABLED=true WORKFLOW_QUEUE_CONCURRENCY=2 pnpm --filter backend start:prod
WORKFLOW_PROCESSOR_ENABLED=true WORKFLOW_QUEUE_CONCURRENCY=2 pnpm --filter backend start:prod
```

注意：当前两种角色仍启动完整 Nest 应用，若同机运行必须分配不同 HTTP 端口；更合理的下一步是加入独立 worker-only bootstrap。正式扩容验收还必须运行真实隔离环境故障矩阵。

## 建议验收门槛（非当前实绩）

- CI 全绿；两 Worker 并发、断连和故障接管可复现；无跨租户 Run/Job 访问；未知工具结果不被自动重放。
- 100 条以上人工审核业务 Golden 样本、>=20 holdout，ACL 泄漏 0；RAG Recall@5 >=0.8，回答正确率 >=0.9；任务完成率 >=0.95；SLO 按快问答/长流程独立统计。
- 缺任一真实证据 -> `blocked`，不能宣称项目工程成熟度达到 9 分。

## 隔离 Redis 错误注入（会写入和删除测试键）

```bash
cd apps/rag-api
export REDIS_URL=redis://127.0.0.1:6379/15
export REDIS_CHECKPOINT_TEST_ISOLATED=I_ACKNOWLEDGE_ISOLATED_REDIS
pnpm run build
pnpm run smoke:checkpoint:atomic-guard
```

务必先确认 Redis 15 号 DB 是可丢弃测试库。正式或共享 Redis 禁止执行。该测试证明特定损坏键状态会在写入前拒绝，不能替代 Redis 断电、AOF 损坏或跨进程故障注入。
