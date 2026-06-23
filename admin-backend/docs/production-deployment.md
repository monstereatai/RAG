# Production Deployment Guide

## 必读：部署前门禁

任何版本上生产前，以下命令必须全部通过：

```bash
# 在 admin-backend/ 目录执行
npm run verify
```

`verify` 等价于：`build` → `lint` → 单元测试 → E2E 测试，任意一步失败则不得部署。

---

## 运行模式

### 默认模式（无外部依赖）

```bash
npm start
```

适用于 CI 冒烟测试、本地快速验证。不需要 MySQL / Redis / RabbitMQ。

### TypeORM + MySQL 模式

```bash
ENABLE_DATABASE=true \
  DB_HOST=your-db-host \
  DB_PORT=3306 \
  DB_USERNAME=app_user \
  DB_PASSWORD=<strong-password> \
  DB_DATABASE=nestjs_enterprise \
  DB_SYNCHRONIZE=false \
  npm start
```

> **⚠️ 生产禁止** `DB_SYNCHRONIZE=true`，必须走迁移脚本。

### 全服务模式（含 Redis + 队列）

```bash
ENABLE_DATABASE=true \
  ENABLE_REDIS=true \
  ENABLE_QUEUE=true \
  REDIS_HOST=your-redis-host \
  REDIS_PORT=6379 \
  npm start
```

---

## 数据库迁移

每次 entity 变更后，按以下步骤操作：

```bash
# 1. 生成迁移文件（需要 ENABLE_DATABASE=true 环境）
ENABLE_DATABASE=true DB_PASSWORD=<pwd> npm run migration:generate

# 2. Review 生成的文件（在 src/database/migrations/）
# 确认 up() 和 down() 逻辑正确

# 3. 执行迁移
ENABLE_DATABASE=true DB_PASSWORD=<pwd> npm run migration:run

# 4. 如需回滚
ENABLE_DATABASE=true DB_PASSWORD=<pwd> npm run migration:revert
```

---

## 必需环境变量清单

| 变量 | 必须 | 说明 | 生产示例 |
|---|---|---|---|
| `NODE_ENV` | ✅ | 运行环境 | `production` |
| `PORT` | 🟡 | 监听端口，默认 3001 | `3001` |
| `JWT_SECRET` | ✅ | JWT 签名密钥，≥32字符 | `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | 🟡 | Token 过期时间，默认 1h | `1h` |
| `ENABLE_DATABASE` | ✅ | 是否启用 MySQL | `true` |
| `DB_HOST` | ✅ | 数据库主机 | `db.internal` |
| `DB_PORT` | 🟡 | 数据库端口，默认 3306 | `3306` |
| `DB_USERNAME` | ✅ | 数据库用户名 | `app_user` |
| `DB_PASSWORD` | ✅ | 数据库密码 | `<strong>` |
| `DB_DATABASE` | ✅ | 数据库名 | `nestjs_enterprise` |
| `DB_SYNCHRONIZE` | ✅ | 生产必须为 false | `false` |
| `ENABLE_REDIS` | 🟡 | 是否启用 Redis 缓存 | `true` |
| `REDIS_HOST` | 🟡 | Redis 主机 | `redis.internal` |
| `REDIS_PORT` | 🟡 | Redis 端口，默认 6379 | `6379` |
| `ENABLE_QUEUE` | 🟡 | 是否启用消息队列 | `true` |
| `ALLOWED_ORIGINS` | ✅ | 允许的前端域名，逗号分隔 | `https://your-frontend.com` |

---

## 健康检查

服务暴露健康检查端点：

```
GET /health
```

响应示例：
```json
{
  "status": "ok",
  "service": "admin-backend",
  "timestamp": "2026-06-17T12:00:00.000Z"
}
```

Kubernetes liveness / readiness probe 示例：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 5
```

---

## 发布检查清单

- [ ] `npm run verify` 通过
- [ ] `GET /health` 返回 `status: ok`
- [ ] 所有必需环境变量在目标平台已配置
- [ ] `DB_SYNCHRONIZE=false` 已确认
- [ ] `JWT_SECRET` 为强随机值（非默认值）
- [ ] 数据库迁移已 review 并执行
- [ ] 回滚镜像/tag 已记录
- [ ] 监控和日志端点从运维网络可达

---

## 性能烟测（部署后验证）

服务启动后可快速验证基础吞吐：

```bash
PERF_REQUESTS=100 PERF_CONCURRENCY=10 npm run perf:smoke
```

> 注意：这是烟测，不是基准报告。企业级性能基准需要在目标机器和数据库下单独建立，当前未完成。
