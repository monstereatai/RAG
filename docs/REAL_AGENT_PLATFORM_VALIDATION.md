# AI Agent 平台三项真实验收（本地隔离环境）

适用仓库：`monstereatai/RAG`，参考 main `ed8c396`（2026-11-01）。

## 边界和前置条件

- 不会读取或破坏现有 Redis/PG 的数据；故障注入脚本 **自己创建独立 Docker Redis**，绑定 `127.0.0.1` 随机端口，完成即删除。
- 需本机 Docker CLI + Docker Engine，可拉取 `redis:7.4-alpine`；运行前先执行 `pnpm install`、`pnpm --filter backend build`。
- 不会自动调用任何生产工具。Worker 压测模拟有幂等契约的工具；无法证明第三方真实发奖、审批、发消息工具天然幂等。
- **禁止把 Redis、PostgreSQL、管理端、故障注入控制接口通过 ngrok 暴露公网。** 真实 RAG API 联调只用隔离账号、受控的非生产服务；管理员运行事件接口最好仅本地访问。
- 私有文档、Goldens、观测草稿保存在 `.tmp/evidence`，该目录已被 `.gitignore` 忽略。**不要 commit 任何真实问答、令牌和业务数据。**

## A. Redis 停止/重启后的真实恢复

在 **RAG 项目根目录** 执行：

```bash
pnpm --filter backend build
cd apps/rag-api
PLATFORM_VALIDATION_ISOLATED=I_ACKNOWLEDGE_DISPOSABLE_TEST_ENV \
  node scripts/verify-real-redis-recovery.mjs
```

脚本执行真正的 `docker run` / `docker stop` / `docker start` / `docker rm -f`，验证：
1. Checkpoint 与 Pending Writes 被写入隔离 Redis；
2. Redis 停止期间 Required 写入拒绝而非静默返回成功；
3. Redis 重启后 Checkpoint + Pending Writes 完整可读；
4. 重启后能够继续写入并清理测试 thread。

报告：`apps/rag-api/.tmp/evidence/platform-redis-recovery.json`。若失败，脚本必须以非 0 退出。注意该实验不涵盖 Postgres/BullMQ 的事务性恢复，也不等同于 Redis Cluster 故障转移测试。

## B. BullMQ 真实多 Worker 并发 + 强杀接管

```bash
cd apps/rag-api
PLATFORM_VALIDATION_ISOLATED=I_ACKNOWLEDGE_DISPOSABLE_TEST_ENV \
  node scripts/verify-multi-worker-failover.mjs --jobs 100 --workers 3 --concurrency 4
```

脚本创建 **自己的隔离 Redis 和唯一命名 Queue**，运行 `victim` 与 3 个独立 Node Worker。首先让 victim 将幂等副作用写入 Redis，**在 BullMQ ACK 之前 SIGKILL**。其他 Worker 接管 Stalled Job；随后处理 100 条新 Job 与 30 次重复 Job 提交。

通过条件：101 条 Job 全部完成，failed=0，101 次且仅 101 次幂等副作用，强杀 Job 至少被两次消费，至少两个独立正常 Worker 参与。输出 P50/P95/P99 与吞吐量。可通过 `--workers 2..8 --concurrency 1..16 --jobs 30..2000` 增加规模，但建议逐级增加，避免本机资源耗尽。

报告：`apps/rag-api/.tmp/evidence/platform-multi-worker.json`。

> 测试**不能**证明真实 `ProductionWorkflowService` 及其数据库、LLM、外部副作用服务已完整通过多实例演练；正式上线仍应增加“真实 Workflow API → Worker → PG/Redis → 工具幂等日志”的隔离联调。

### 可选：真实产研 Workflow API 并发联调（会产生模型费用）

前面的 BullMQ 强杀实验测试的是队列及幂等工具基础设施。如需真正验证业务端到端执行，请先在**隔离测试环境**启动 API、PG、Redis 和至少 2 个真实 Worker 实例（每个 Worker 需分别配置 `WORKFLOW_PROCESSOR_ENABLED=true`）。**不要在生产环境运行，也不要将管理员路由映射公网。**

```bash
cd apps/rag-api
export RAG_EVAL_ACCESS_TOKEN='***'
export PLATFORM_VALIDATION_STAGING_CONFIRMED=I_ACKNOWLEDGE_ISOLATED_STAGING
export PLATFORM_VALIDATION_ALLOW_LLM_COST=I_ACKNOWLEDGE_TEST_COST
node scripts/benchmark-real-workflow-cluster.mjs --total 30 --concurrency 3 \
  --base-url http://127.0.0.1:3000/api/v1
```

报告：`.tmp/evidence/platform-real-workflow-cluster.json`，真实请求数、成功率、P95、吞吐均直接来自隔离 API。若工作流完成率不为 100%，脚本失败。**该脚本不能单独证明多个机器都执行了任务**：需将 Worker 日志按实例 ID 对账，另外补齐工具幂等审计；`workerDistributionVerified:false` 不是漏洞而是诚实标记。

## C. 真实 Golden Dataset + 真实 API + 人工审核

代码不生成真实业务 Golden！它只严格消费已经获授权、脱敏、人工审核的来源。

1. 私下准备 `apps/rag-api/.tmp/evidence/real-golden.dataset.json`：沿用 `eval/reviewed-golden.example.json` 的格式，但使用**真实**源文档的 `sourceHash`、`sourceUri`、`expectedDocIds`、`expectedChunkIds`、`expectedClaims`，`synthetic:false`，至少 100 条用例/至少 20 条 Holdout，覆盖 7 个既有场景。不要上传到公共 GitHub。
2. 使用**非生产** RAG API 账号，传入 Token，连接 `http://127.0.0.1:3000/api/v1` 或受控的 ngrok API 入口。
3. Agent 案例：先在隔离环境真实执行 Agent 工作流，将 case ID -> 实际 Run ID 的 JSON 映射保存到私有路径；并在本地管理员 API 提供 `RAG_ADMIN_ACCESS_TOKEN`，脚本只读取已发生的运行事件，不会自行触发 Agent 工具。**不要把管理端公网暴露。**

```bash
cd apps/rag-api
export RAG_EVAL_ACCESS_TOKEN='***'
export RAG_ADMIN_ACCESS_TOKEN='***'
# 如果测试 API 映射到其他地址，替换 --base-url；管理员 API 默认本地。
node scripts/capture-reviewed-golden-real.mjs \
  --dataset .tmp/evidence/real-golden.dataset.json \
  --agent-run-map .tmp/evidence/real-agent-run-map.json \
  --base-url http://127.0.0.1:3000/api/v1
```

输出 `private-golden-observations.draft.json`，**humanReview 为 null 是刻意设计**；不得自动视为通过。由独立审核人对答案、引用、是否越权、是否产生副作用、Agent 事件链逐项检查，在私有 JSON 中填写 `humanReview`，然后重命名为 `private-golden-observations.reviewed.json`。不允许自动复制既有 dataset 的 reviewer 结论给实际运行。

```bash
node scripts/verify-reviewed-golden-business.mjs \
  --dataset .tmp/evidence/real-golden.dataset.json \
  --observations .tmp/evidence/private-golden-observations.reviewed.json
```

发布门禁：数据集 >=100、Holdout >=20、真实快照 hash、至少 7 类场景、Agent 和 RAG **各自**达到要求（不能平均稀释），Holdout 通过率 >=90%、RAG Recall@5 >=80%、P95 <=30s、ACL 泄漏 0。真实数据不足、Token 失效、缺少运行事件、没有独立审核时，必须失败。

> 注意：当前 ChatResponse 中参考文档的 `docVersion` 字段可能缺失，涉及“版本生效”的用例需要从有权限的真实索引/检索事件补全可核验版本；**不能推断版本、不能伪造引用**。`capture` 只识别回答中的真实引用标记，不能把全部 `references` 当成已引用。

## D. 原有 CI 修复与分层

`eval:query-routing` 的 mock `LlmProvider` 缺少 `getActiveProviderName/getFallbackProviderName/getRoutePolicy`，触发全量 fallback；已补测试桩。`eval:agent-platform` 的离线项目 E2E 应允许以明确 skipped 方式通过**普通 PR 流水线**，但 `AGENT_PLATFORM_REQUIRE_LIVE=true` 时仍须真正执行、不可跳过。真实质量门禁应在启动服务的隔离环境执行，不可把 CI 合同通过误称为真实质量通过。

## E. 合格证据与剩余风险

三份报告保留版本号、Git commit、环境和原始测试记录；高风险要求另外保存独立人工报告。Redis 故障和 BullMQ 重新执行测试当前是**真实 Docker 基础设施**验证，真实跨存储对账、工具副作用与 LLM 产研工作流联调应当单独执行。**未执行测试不得宣称 9 分或已达到生产 SLO。**
