# 钉钉机器人通知集成方案

## Context

主人提供钉钉群机器人 webhook（加签模式，已存入 `backend/.env`：`DINGTALK_WEBHOOK_URL` + `DINGTALK_SECRET`，加签算法已实测验证通过）。需要三个场景的群推送：

1. **审批通知**：产研运工作流到达人工审批节点（`pending_approval`）
2. **告警通知**：Milvus 熔断打开、异步文档任务失败、检索降级 BM25
3. **问答推送**：指定会话（threadId 白名单）的 RAG 回答转发

## 核心设计

- 新 Provider 遵循 `LangfuseProvider` 模式（[langfuse.provider.ts](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/providers/observability/langfuse.provider.ts)）：ConfigService 读 `dingtalk.*`、isEnabled、getStatus、smoke
- **只暴露三个场景方法**（调用方不拼 payload）：`notifyApproval` / `notifyAlert(key, text)` / `forwardRagAnswer`
- **fire-and-forget**：所有通知失败只 `logger.warn`，永不阻塞业务
- **加签算法**（钉钉官方 Python 示例，已实测）：secret 为 HMAC key，`timestamp+"\n"+secret` 为消息，HMAC-SHA256 → base64 → urlencode → 拼 URL
- **告警节流**：Map 同步 check+set，默认 5 分钟窗口；**审批通知不节流**（修订后再待审批是新事件）

## 实施步骤

### 1. 新建 `backend/src/providers/notify/dingtalk.provider.ts`
- 构造函数读配置：webhookUrl / secret / alertCooldownMs（默认 300_000）/ forwardThreadIds（逗号分隔，空=关闭场景 3）
- 私有 `sendText` / `sendMarkdown`（fetch + 加签 URL + AbortSignal.timeout 5s）
- 公开：`notifyApproval({threadId, projectId, brief, completedRoles, pendingApprovalRoles})`、`notifyAlert(key, text)`（节流）、`forwardRagAnswer({threadId, query, answer, mode, latencyMs, citationCount})`（白名单过滤，answer 截断 1800 字符）、`isEnabled/getStatus/smoke`

### 2. 新建 `backend/src/providers/notify/notify.module.ts`
- `@Global()`，imports ConfigModule，providers/exports DingTalkProvider（仿 [observability.module.ts](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/providers/observability/observability.module.ts)），挂到 app.module.ts

### 3. 三个场景接入（均已核实挂点）
- **审批**：[production-workflow.service.ts:975](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/modules/workflow/production-workflow.service.ts) 附近（status 设为 `pending_approval` 处），上下文有 state（threadId/projectId/brief/roles）
- **熔断**：[milvus.vector-store.ts:651](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/providers/vector-store/milvus.vector-store.ts) `openCircuit()`，`@Optional()` 注入防构造依赖问题，节流 key=`milvus.circuit`
- **任务失败**：[document.service.ts:643](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/modules/document/document.service.ts) `updateTask` 失败处；实现时确认 document-queue.service.ts L109 `worker.on('failed')` 是否汇聚到同一处，只挂一处防双发
- **检索降级**：karpathy-rag.service.ts 向量检索 catch 降级 BM25 分支，节流 key=`retrieval.bm25_fallback`
- **问答推送**：[chat.service.ts:716](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/modules/chat/chat.service.ts) 与 [agui.service.ts:471](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/modules/agui/agui.service.ts)（与 traceRagAnswer 同位置）

### 4. 可观测端点 + smoke
- [observability.controller.ts] 加 `GET /observability/dingtalk/status|health` + `POST /observability/dingtalk/smoke`
- 新建 `backend/scripts/smoke-dingtalk.mjs`（仿 [smoke-langfuse.mjs](file:///Users/monster/Documents/GitHub/code/RAG/backend/scripts/smoke-langfuse.mjs)：登录 → 调 HTTP 端点）
- `backend/package.json` 加 `smoke:dingtalk`

### 5. 配置与文档
- [configuration.ts](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/config/configuration.ts) L279 后加 dingtalk 分组：webhookUrl/secret/alertCooldownMs/forwardThreadIds
- `.env.example` 补钉钉配置段（说明密钥格式）
- 完成后同步 ROADMAP.md

### 6. 单测 `dingtalk.provider.spec.ts`
仿 [langfuse.provider.spec.ts](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/providers/observability/langfuse.provider.spec.ts)，覆盖：
- 禁用/缺 key 安全返回
- 签名确定性（固定 timestamp+secret 断言 base64 结果）
- 节流窗口（同 key 二次不发、窗口过后再发）
- 白名单过滤、审批不节流
- fetch 失败仅 warn 不抛

## 风险与已知限制

- 多实例部署时节流 Map 不共享（单实例够用，记为已知限制）
- 钉钉限流 20 条/分钟：白名单+节流+截断后安全
- 无循环依赖：NotifyModule 只依赖 ConfigModule

## 验证

```bash
cd backend && npm run build && npm run lint
cd backend && npm test -- dingtalk.provider --runInBand
cd backend && npm run smoke:dingtalk   # 真实发送，群里收到测试消息
```

手动场景验证：发起工作流到审批节点 → 群收到通知；配置 forwardThreadIds 后在该会话提问 → 群收到回答转发。
