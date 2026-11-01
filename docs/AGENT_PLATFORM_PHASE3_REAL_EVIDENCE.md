# Agent 平台最终验收：PostgreSQL ↔ BullMQ + 真实业务 Golden

本验收包基于现有仓库的 `DomainEventsService`、`DomainEventOutboxEntity`、`ProductionWorkflowQueueService`、`RedisCheckpointer` 和 `verified-golden.mjs`。**不连接或清理任何已有生产 Redis/PostgreSQL**。

## 0. 安装

在 `RAG/` 项目根目录：

```bash
python3 agent_platform_final_evidence/apply.py --check
python3 agent_platform_final_evidence/apply.py
pnpm --filter backend build
pnpm --dir apps/rag-api run verify:human-review:test
node --check apps/rag-api/scripts/verify-cross-store-recovery.mjs
git diff --check
```

## 1. 真实 PostgreSQL + BullMQ 跨存储故障恢复

要求：本机 Docker Desktop 已启动，有空间拉取 `postgres:16-alpine` 和 `redis:7.4-alpine`。**不需要暴露公网/ngrok**。

```bash
cd apps/rag-api
export PLATFORM_VALIDATION_ISOLATED=I_ACKNOWLEDGE_DISPOSABLE_TEST_ENV
pnpm run verify:cross-store:recovery
```

脚本自行创建两个 **唯一名字、只映射 `127.0.0.1` 临时端口**的 Docker 容器，使用全新的测试库、测试队列和虚构 `test-*` 身份，最后自动删除容器与匿名数据卷。

真实验收点：

1. 单个 PostgreSQL 事务同时写入业务记录和 Outbox；强制回滚后两者均不存在。
2. 业务事务提交后重启 PostgreSQL，再确认 Outbox 和业务记录存在；启动 dispatcher 补偿入队。
3. 独立子进程在 BullMQ `Queue.add` 已成功之后使用 `process.exit(73)` 强杀自身（模拟入队后、Outbox ack 前宕机）；恢复 dispatcher 并核对 `Job ID` 去重与 Outbox 状态。
4. Redis 真实停机期间，Outbox 保持 `pending`；重启后由 dispatcher 补偿投递。
5. SQL 验证 3 条已确认意图；BullMQ 验证只保留 3 个 Job，没有重复投递成独立任务。

结果在 `.tmp/evidence/platform-cross-store-recovery.json`；任一条件不满足返回退出码 1。**不对真正业务工具执行写入**，因此不等于对接飞书、企微、支付等外部副作用的 exactly-once 验证；BullMQ ID 去重还依赖 Job 保留期。

## 2. 真实 Golden Dataset + 人工复核 + 严格发布

需要你准备授权使用且已脱敏的、真实业务的私有 Golden Dataset。不能从演示数据、LLM 自动回答或自造事实声称是真实业务。

基本要求：不少于 **100 条真实案例**、至少 **20 条 Holdout**，涵盖 `direct / cross_document / version / acl / refusal / tool_failure / checkpoint_resume`，包含 Agent 和 RAG；每条记录真实来源 ID/哈希、源文件有效性、期待 Doc/Chunk、预期 claims 或事件、独立来源标注审核。实际 Agent Run 的 `runId` 必须在已有运行中心存在。

第一步：按现有 `eval/reviewed-golden.example.json` 字段准备私有 `eval/private-reviewed-golden.json`；将真实 RAG 数据导入隔离测试知识库，确保登录账号只具备相应权限。Agent 侧执行真实工作流，记录 `caseId -> runId` 映射到私有 JSON：

```json
{"agent-case-001":"实际运行中心的 runId"}
```

第二步：从**真实服务**采集，不允许伪造人工评分。设置 Token 环境变量（勿放到命令行或 Git 仓库）：`RAG_EVAL_ACCESS_TOKEN`、`RAG_ADMIN_ACCESS_TOKEN`、`RAG_API_BASE_URL`、`RAG_ADMIN_API_BASE_URL`。若使用公网 ngrok，仅使用隔离测试 API 与受限 Token，建议本地地址；**不要暴露 Redis、PostgreSQL**。

```bash
pnpm run verify:golden:capture -- \
  --dataset eval/private-reviewed-golden.json \
  --agent-run-map eval/private-agent-run-map.json \
  --out .tmp/evidence/private-golden-observations.draft.json
```

第三步：生成**全部未审核**的待复核清单：

```bash
pnpm run verify:golden:prepare-review -- \
  --dataset eval/private-reviewed-golden.json \
  --capture .tmp/evidence/private-golden-observations.draft.json \
  --out .tmp/evidence/private-review-sheet.json
```

人工查验源文件、最终回答、实际引用 ID、版本/时效、权限泄露、Agent 轨迹、工具调用异常及 Checkpoint 后的重复副作用，在 `private-review-sheet.json` 中对每个案例填写：`reviewerId`, `reviewedAt`（ISO 时间，必须晚于 API 采集）, `approved: true`, `correct: true/false`, `citationsSupported: true/false`；不正确需备注原因。**复核人必须不同于数据源标注人**。审核批准只是确认审核已完成，并不代表测试结果正确。错误用例必须保留为 `false`。

第四步：冻结采集哈希与人工审核结果，再执行生产等级门禁：

```bash
pnpm run verify:golden:finalize-review -- \
  --dataset eval/private-reviewed-golden.json \
  --capture .tmp/evidence/private-golden-observations.draft.json \
  --review .tmp/evidence/private-review-sheet.json \
  --out .tmp/evidence/private-golden-observations.reviewed.json

pnpm run verify:golden:business -- \
  --dataset eval/private-reviewed-golden.json \
  --observations .tmp/evidence/private-golden-observations.reviewed.json \
  --out .tmp/evidence/private-golden-release.json
```

原仓库质量门禁必须同时满足 `scoreGoldenDataset({production:true,minCases:100,minHoldout:20})` 和 `applyReleaseGate`。评测报告只包含审核元数据、指标与哈希，不再复制回答正文。绝不能将 `private-*.json` 或 `.tmp/evidence` 上传公开仓库。

**当前接口边界：** `ChatReference` 中未必暴露 `docVersion`；版本类用例若无法从真实 API 取得生效版本，会**如实判失败**。Agent Run 只能取已有真实历史，不能自动制造真实业务场景。`test:hardening`/测试样本通过也不算业务 Golden 通过。

## 3. 最终四份证据验收

结合之前通过的 Redis Checkpoint 与多 Worker 演练：

```bash
pnpm run verify:platform:all-evidence
```

检查 `.tmp/evidence/platform-redis-recovery.json`, `platform-multi-worker.json`, `platform-cross-store-recovery.json`, `private-golden-release.json` 是否真实存在、各自通过、满足验收字段。报告 `.tmp/evidence/platform-9-acceptance.json` 保存四份来源的 SHA256，任一缺失或未达标均退出码 1。

### 注意

- 不自动认可模拟 Golden、未审核案例、缺少真实 Run 或没有明确引用的回答。
- 测试和报告只能证明对应时间、版本、业务集与部署条件的行为；不能据此直接断言生产高可用或保证任何分数。
- 若真正部署多租户 AI 平台，还需独立验证高风险外部工具审批、租户隔离、数据库/Redis 主备切换与限流降级。
