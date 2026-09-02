# 领域事件 Hook 与 Outbox 使用指南

## 用途

该能力用于把业务主链路与外部通知解耦。内部生命周期 Hook 只负责产生稳定领域事件；事件先持久化到 PostgreSQL Outbox，再由 Worker 可靠投递到企业微信机器人或通用 Webhook。

不支持上传、执行或热加载任意 Hook 代码。

## 已接入事件

| 事件 | 触发时机 |
| --- | --- |
| `document.review_approved`／`document.review_rejected` | 文档审核通过／驳回 |
| `document.effective` | 已审核文档设为生效版本 |
| `document.lifecycle_changed` | 文档生命周期被调整 |
| `workflow.approval_required` | 产研运工作流等待审批 |
| `workflow.revision_required` | Artifact 被驳回，进入修订 |
| `workflow.completed`／`workflow.failed` | 工作流完成／失败 |
| `job.completed`／`job.failed` | 定时任务完成／失败 |

## 工作方式

```text
业务服务内部 Hook
  → DomainEventsService.emit
  → domain_event_outbox（pending）
  → Worker 每 10 秒拉取
  → 按订阅规则匹配事件
  → 从 endpointKey 读取服务端 URL
  → 企业微信／通用 Webhook
  → delivered、failed 或 skipped
```

状态含义：

- `pending`：等待投递或等待下一次重试。
- `delivered`：所有匹配订阅投递成功。
- `failed`：连续失败达到 3 次，需要管理员处理后手动重试。
- `skipped`：当前没有启用且匹配该事件的订阅；主业务仍正常完成。

## 配置订阅规则

后台服务通过以下接口管理，均受已有 RAG Admin 服务鉴权保护：

```text
GET  /api/v1/rag/admin/domain-events/subscriptions
POST /api/v1/rag/admin/domain-events/subscriptions
GET  /api/v1/rag/admin/domain-events/outbox
POST /api/v1/rag/admin/domain-events/outbox/:id/retry
```

创建企业微信订阅示例：

```json
{
  "name": "工作流审批提醒",
  "eventTypes": ["workflow.approval_required", "workflow.failed"],
  "channel": "enterprise_wechat",
  "endpointKey": "EVENT_WEBHOOK_ENTERPRISE_WECHAT_URL",
  "enabled": true
}
```

`endpointKey` 是服务端配置名，不是 URL。部署环境将该配置名对应到真实企业微信机器人地址；数据库、运行事件和日志都不会保存该地址。

通用 Webhook 使用 `channel: "webhook"`，请求体包含事件 ID、事件类型、聚合对象、脱敏 payload 与发生时间。

## 失败处理

1. 在 Outbox 列表筛选 `failed`。
2. 确认配置键已在部署环境注入，并确认目标端服务正常。
3. 调用 `POST /api/v1/rag/admin/domain-events/outbox/:id/retry`。
4. 事件重置为 `pending` 并重新从 0 开始计数；不要通过复制事件制造重复通知。

## 安全边界

- 事件 payload 会移除 `prompt`、`token`、`password`、`secret` 字段。
- URL、Token 和密码不进入数据库、日志、MCP、CLI 或 Artifact。
- Outbox 失败不回滚文档审核、工作流或定时任务的主业务结果。
- MCP 只读查询项目状态，不提供订阅配置和重试写操作。
- 新增事件必须先定义稳定事件名和脱敏 payload，再接入对应服务 Hook。

## 验证

```bash
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend run build
pnpm --dir backend exec typeorm-ts-node-commonjs migration:show -d src/providers/db/typeorm.config.ts
```

迁移 `AddDomainEventOutbox1787600000000` 已创建 `domain_event_outbox` 与 `domain_event_subscriptions`。
