# 异步任务队列生产级增强方案

> 日期：2026-06-30 | 状态：待确认 | 类型：基础设施增强

## 问题

当前文档上传后的处理（切片、Embedding、向量入库、图谱抽取）在请求线程内同步执行。
大规模文件或多媒体文件（图片 OCR、视频理解）会阻塞 HTTP 响应，不适合生产环境。

现有 `document_tasks` 表记录任务状态，但缺少跨进程任务队列。

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

### 需要新增的依赖

- `@nestjs/bullmq` + `bullmq`（已规划在 RAG 能力内，非计划外依赖）
- `ioredis`（可能已有，查一下）

### 不涉及的红线

- 不需要数据库 schema 变更（复用现有 `document_tasks` 表）
- 不需要修改 `.env`（复用现有 `REDIS_*` 配置）
- 不删除文件

### 实施步骤

1. 安装 `@nestjs/bullmq`、`bullmq`
2. 创建 `DocumentProcessingQueue`（BullMQ 队列定义）
3. 创建 `DocumentProcessingWorker`（消费任务）
4. 修改 `DocumentService.upload`：同步上传改写入队列后返回 taskId
5. 前端修改：上传后轮询 task 状态展示进度
6. 验证：上传大文件 → 返回 taskId → 轮询到 completed

## 实施前提

需要你确认：
- [ ] 同意安装 `@nestjs/bullmq` + `bullmq` 依赖
- [ ] 同意使用 Redis（已有 `RedisModule`，需确认连接可用）
