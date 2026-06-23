# Admin Backend

企业智能知识库系统的独立管理后台后端。项目拆成两层：`core` 是默认基座，`enterprise` 保留企业增强能力和集成样例。功能没有删减，但默认本地模式不依赖 MySQL、Redis、RabbitMQ、Vault 或 OTLP。

## ✨ 特性

- 🚀 **两层架构** - `core` 提供基础服务骨架，`enterprise` 保留高级能力
- 🔒 **安全防护** - 完整的OWASP Top 10安全防护措施
- 💾 **高可用设计** - 数据库主从复制、读写分离、Redis缓存、消息队列
- 🔄 **负载均衡与容灾** - Nginx负载均衡、熔断降级、链路追踪
- 🐳 **容器化部署** - Docker + Kubernetes (带 HPA 与 Ingress)
- 📊 **监控与日志** - Prometheus + Grafana (原生 `/metrics` 接口) + Pino JSON日志 + OpenTelemetry 分布式追踪
- 🧪 **测试体系** - 单元测试、集成测试、E2E测试、k6 阶梯并发压测
- 🚀 **自动化流** - GitHub Actions 门禁流水线、TypeORM 安全迁移闭环
- 📝 **完整文档** - API文档、部署文档、使用指南

## 🏗️ 架构设计

```
├── src/
│   ├── core/                # 基础层聚合：Config / Logger / Schedule / Auth / User
│   ├── enterprise/          # 企业增强层聚合：安全、权限、队列、指标、部署等能力
│   ├── common/              # 公共模块
│   │   └── interceptors/    # 拦截器
│   ├── modules/             # 业务模块
│   │   ├── user/           # 用户服务
│   │   ├── auth/           # 认证服务
│   │   ├── order/          # 订单服务
│   │   ├── payment/        # 支付服务
│   │   ├── notify/         # 通知服务
│   │   ├── permission/     # 权限控制
│   │   ├── admin/          # 管理功能
│   │   ├── admin-documents/# 管理后台文档治理入口
│   │   ├── rag-client/     # 调用独立 RAG 服务的 HTTP client
│   │   ├── rag-ops/        # RAG 运营入口：索引、评测、会话
│   │   ├── audit-logs/     # 后台审计日志查询
│   │   ├── admin-notifications/ # 后台通知中心
│   │   ├── system-config/  # 后台系统配置状态
│   │   ├── security/       # 安全服务
│   │   └── metrics/        # 原生监控指标服务 (Prometheus format)
│   ├── database/            # 数据库
│   │   ├── entities/       # 数据实体
│   │   └── replication/    # 读写分离
│   ├── queue/              # 消息队列
│   ├── circuit-breaker/    # 熔断器
│   ├── tracing/            # 链路追踪
│   ├── cache/              # 缓存服务
│   └── config/             # 配置管理
├── docker/                 # Docker/Compose 配置 (含 Nginx, Prometheus 与 Grafana 预配)
├── kubernetes/             # Kubernetes 生产编排配置 (HPA, Ingress, ConfigMap)
├── scripts/                # 部署与性能检测脚本
└── docs/                   # 最佳实践与集成对接文档
```

### 两层边界

| 层 | 入口 | 用途 |
|---|---|---|
| `core` | `src/core/core.module.ts` | 新业务服务默认需要的最小基座：配置、日志、认证、用户、验证和文档基础 |
| `enterprise` | `src/enterprise/enterprise.module.ts` | 高级能力集合：RBAC、安全审计、缓存、队列、指标、链路追踪、文件、任务、部署资产 |

详细边界见 [docs/backend-layers.md](docs/backend-layers.md)。
管理后台独立服务方案见 [docs/admin-backend-service.md](docs/admin-backend-service.md)。

## 🚀 快速开始

### 1. 环境要求

- Node.js 18.x+
- npm 8.x+
- Docker & Docker Compose（容器化部署时需要）
- MySQL 8.0+（开启 `ENABLE_DATABASE=true` 时需要）
- Redis 7.0+（开启 `ENABLE_REDIS=true` 时需要）
- RabbitMQ 3.x（开启 `ENABLE_QUEUE=true` 时需要）

### 2. 安装依赖

```bash
npm install
```

### 3. 环境配置

```bash
# 默认按 NODE_ENV 读取环境文件，本地 development 会读取 .env.development + .env
npm start
```

### 4. 启动应用

```bash
# 开发 watch 模式，编译产物输出到 build/dev，避免旧 dist 干扰
npm run start:dev

# 默认本地模式，不依赖 MySQL/Redis/RabbitMQ
npm start

# TypeORM 数据库模式 (本地开发)
ENABLE_DATABASE=true DB_PASSWORD=123456 DB_SYNCHRONIZE=true npm start

# 生产环境安全迁移机制
npm run migration:generate
npm run migration:run

# 完整代码质量与测试验证门禁
npm run verify

# CI 同款门禁：含覆盖率阈值和迁移规则检查
npm run verify:ci

# Docker 基础设施集成验证：需先启动 MySQL/Redis/RabbitMQ
INTEGRATION_TESTS=true npm run verify:integration

# k6 阶梯式并发压测基准测试
npm run perf:k6
```

`start:dev` 使用 `tsconfig.dev.json`，不会复用历史 `dist/src` 产物。

## 📋 功能模块

### 认证授权
- JWT认证
- Access Token + Refresh Token
- RBAC权限控制（token 携带 permissions，PermissionGuard 按权限码校验）
- 角色装饰器
- 权限守卫

### 安全防护
- Helmet安全头
- CORS保护
- 速率限制
- CSRF防护
- XSS防护
- SQL注入防护
- 数据加密

### 高可用设计
- 数据库主从复制
- 读写分离
- Redis缓存
- 消息队列
- 负载均衡

> 说明：默认模式使用内存降级以保证模板开箱运行。数据库、Redis、队列、Vault、OTLP 等真实外部服务均为显式开启模式。

### 可观测性与审计 (Observability)
- Pino 高性能 JSON 日志
- OpenTelemetry 全链路 TraceID 追踪
- 业务级 `@AuditLog` 操作审计防篡改
- 全局异常统一下游拦截

### 熔断降级
- 自定义熔断器 (CircuitBreaker)
- 超时控制
- 异常重试机制

## 🔧 配置说明

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| NODE_ENV | 运行环境 | development |
| PORT | 服务端口 | 3001 |
| ENABLE_DATABASE | 是否启用 TypeORM 数据库连接 | false |
| DB_HOST | 数据库主机 | localhost |
| DB_USERNAME | 数据库用户名 | root |
| DB_PASSWORD | 数据库密码 | dev_password123 |
| DB_DATABASE | 数据库名 | nestjs_enterprise_dev |
| DB_SYNCHRONIZE | 是否自动同步表结构 | true |
| ENABLE_REDIS | 是否启用 Redis 连接 | false |
| REDIS_HOST | Redis主机 | localhost |
| ENABLE_QUEUE | 是否启用 RabbitMQ/Bull 队列 | false |
| JWT_SECRET | JWT密钥 | your-secret-key |
| RABBITMQ_URL | RabbitMQ连接URL | amqp://localhost:5672 |
| RAG_SERVICE_BASE_URL | 独立 RAG 服务 API 地址，仅后台 RAG 运营入口使用 | http://localhost:3000/api/v1 |
| RAG_SERVICE_TIMEOUT_MS | 后台调用 RAG 服务超时时间 | 2000 |

### 安全配置

```typescript
// 安全中间件配置
helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
    },
  },
}

// 速率限制配置
rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 限制100个请求
}
```

## 📊 监控与日志

### 应用监控

```bash
# 查看服务状态
./scripts/deploy.sh status

# 查看日志
./scripts/deploy.sh logs

# 健康检查
curl http://localhost:3001/health
```

### 指标监控

- 指标数据接口: http://localhost:3001/metrics
- Prometheus 控制台: http://localhost:9090
- Grafana 仪表盘: http://localhost:3000
- RabbitMQ 管理后台: http://localhost:15672

## 🐳 部署方案

### Docker Compose

```bash
# 启动所有服务
docker-compose up -d

# 查看状态
docker-compose ps

# 停止服务
docker-compose down
```

### Kubernetes

```bash
# 部署到K8s
./scripts/deploy.sh deploy-k8s

# 查看Pod状态
kubectl get pods -n production

# 查看服务
kubectl get services -n production
```

## 🧪 测试

```bash
# 运行测试
npm test

# 测试覆盖率
npm run test:cov

# E2E测试
npm run test:e2e

# 完整质量门禁
npm run verify

# k6 企业级阶梯式并发压测
npm run perf:k6
```

## 📚 API文档

应用启动后访问以下地址：

- Swagger UI: http://localhost:3001/api
- 健康检查: http://localhost:3001/health

## 📚 项目文档

- [生产部署指南](docs/production-deployment.md)
- [企业级后端最佳实践](docs/best-practices.md)
- [前端集成指南](docs/frontend-integration.md)
- [后台服务分层说明](docs/backend-layers.md)
- [生产就绪门禁](docs/production-readiness.md)

## 🔧 开发指南

### 添加新模块

```bash
# 生成模块
nest g module modules/example

# 生成服务
nest g service modules/example

# 生成控制器
nest g controller modules/example
```

### 自定义拦截器

```typescript
@Injectable()
export class CustomInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    // 拦截逻辑
    return next.handle();
  }
}
```

### 使用缓存

```typescript
@Injectable()
export class ExampleService {
  constructor(private readonly cacheService: CacheService) {}

  async getData() {
    return this.cacheService.get('data:key') || 
      await this.cacheService.set('data:key', fetchData(), 3600);
  }
}
```

## 📊 已完成功能

### 第一阶段：基础架构 ✓ 已完成
- [x] NestJS项目初始化
- [x] 微服务架构基础
- [x] 核心业务模块（用户、认证、订单、支付、通知）
- [x] JWT + RBAC认证授权
- [x] 基础数据模型

### 第二阶段：安全与高可用 ✓ 已完成
- [x] OWASP Top 10安全防护
- [x] 数据库主从复制
- [x] 读写分离
- [x] Redis缓存
- [x] 消息队列
- [x] 负载均衡
- [x] 熔断降级
- [x] 链路追踪

### 第三阶段：部署方案 ✓ 已完成
- [x] Docker容器化
- [x] Kubernetes部署 (包含 HPA, Ingress, ConfigMap)
- [x] 自动化部署脚本
- [x] 环境配置管理

### 第四阶段：云原生与可观测性落地 ✓ 已完成
- [x] Pino 高性能异步 JSON 日志采集
- [x] OpenTelemetry 标准化分布式追踪
- [x] AuditLog 核心业务高敏感操作防篡改审计
- [x] k6 大厂级阶梯并发压测支持
- [x] TypeORM CLI 数据平滑迁移安全闭环
- [x] 基于 GitHub Actions 的规范化 CI/CD 流水线

### 第五阶段：一致性审计与可观测性监控补全 ✓ 已完成
- [x] 原生 Prometheus `/metrics` 指标接口（内存、运行时间、请求数及耗时分布）
- [x] 原生 Node.js 进程级 CPU 性能指标收集（用户态/内核态时间累计）并支持 Grafana 折线图实时展示
- [x] 大厂级 gRPC 微服务设计参考（Protobuf 协议定义与 RPC 控制器模版）
- [x] 金融级密钥管理（HashiCorp Vault 原生动态密钥加载与拉取服务）
- [x] 分库分表底层支持（基于 TypeORM 多数据源的分片哈希路由服务与单测环境优雅降级）
- [x] 核心安全中间件全局生效（CORS、Helmet、速率限制、CSRF），支持测试环境与公开接口绕过
- [x] 订单状态、支付状态、用户更新路由全面覆盖强类型 DTO 约束，Swagger 文档精准展示
- [x] 补全 Prometheus + Grafana 容器配置与仪表盘，支持开箱即用可视化监控

## 📄 许可证

[MIT License](LICENSE)
