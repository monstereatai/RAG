# 异步任务队列生产级增强方案

> 日期：2026-06-30｜校准日期：2026-08-03｜状态：已实施并验证｜类型：基础设施增强

## 问题

原始问题是文档上传后的切片、Embedding 和索引处理在请求线程内同步执行。当前已经接入 BullMQ 和 Redis Worker，异步任务会写回状态，Redis 不可用时保守降级为同步处理。

## 目标

把文档处理从同步变为异步：上传返回 `taskId`，后端队列消费，前端轮询进度。

## 方案

### 选型：BullMQ（基于 Redis）

| 方案 | 优点 | 缺点 |
|------|------|------|
| BullMQ | 成熟、延迟队列、重试、进度报告、NestJS 官方集成 | 依赖 Redis |
| 进程内 Map | 零依赖 | 进程重启丢失、无法水平扩展 |
| RabbitMQ | 更重的企业级能力 | 需要额外部署，当前无 RabbitMQ |
| Kafka | 日志型，不适合任务队列 | 需要额外部署 |

**推荐：BullMQ + Redis（Redis 已部署）**

### 架构

```
Upload → API → 创建 document_task (status: pending)
             → BullMQ 队列 → Worker 消费
                 ├─ 文档切片
                 ├─ Embedding 生成
                 ├─ 向量写入 Milvus
                 ├─ 图谱抽取（Neo4j）
                 └─ 更新 task status (processing / completed / failed)
Client → 轮询 GET /api/v1/documents/tasks/:taskId → 返回进度
```

### 已使用的依赖

- `@nestjs/bullmq` + `bullmq`
- `ioredis`

### 不涉及的红线

- 不需要数据库 schema 变更（复用现有 `document_tasks` 表）
- 不需要修改 `.env`（复用现有 `REDIS_*` 配置）
- 不删除文件

### 实施状态

- [x] 安装并固定 `@nestjs/bullmq`、`bullmq` 和 `ioredis`。
- [x] 创建文档处理 Queue 与 Worker。
- [x] 异步上传返回任务标识，Worker 调用真实解析、Embedding 和索引链路。
- [x] 处理成功／失败写回 `document_tasks`，空内容失败也会落状态。
- [x] 提供任务状态 API，修复 `queue/status` 路由顺序。
- [x] Redis 未配置或不可用时降级为同步处理。

目标机器上的队列容量、并发、积压告警和故障恢复仍属于根目录 `ROADMAP.md` 中的生产规格压测事项，不在本文档重复维护。
