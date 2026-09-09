# RAG Platform Deployment Checklist

> 本清单用于发布前核对。勾选本地代码和配置项，不把“服务能启动”误认为“已具备生产条件”。

## 代码与契约

- [ ] Backend build 通过：`pnpm --dir backend run build`
- [ ] Admin Backend build 通过：`pnpm --dir admin-backend run build`
- [ ] Swagger JSON 可访问，接口摘要和描述为中文
- [ ] OpenAPI 契约检查通过：`OPENAPI_REQUIRED=true pnpm --dir backend run contract:openapi`
- [ ] 内部服务 Token 未写入代码、日志或前端资源
- [ ] 数据库迁移已在预发布环境演练，未启用 TypeORM 自动同步

## 依赖服务

- [ ] PostgreSQL 连接池、连接超时和最大连接数已按生产规格配置
- [ ] Redis 可用，BullMQ、Agent 快照和分布式锁均通过 smoke
- [ ] Milvus／Elasticsearch／Neo4j 已完成连接、索引和权限检查
- [ ] 对象存储可写入并能通过鉴权代理读取文档素材

## RAG 与安全

- [ ] RAG 质量门禁通过：`pnpm --dir backend run eval:rag:quality`
- [ ] Prompt 注入和危险操作回归集通过
- [ ] 文档权限、版本生效时间和废弃状态完成抽样验证
- [ ] 安全策略、拦截指标和审计查询接口可访问
- [ ] 安全拦截事件已脱敏持久化到 Domain Event Outbox，并可从后台审计入口查询

## Agent 与任务

- [ ] Agent 预算、超时、审批和快照恢复测试通过
- [ ] 定时任务使用 Redis 租约避免多实例重复执行
- [ ] Redis 可用时定时任务进入 BullMQ 延迟队列；需验证 Worker 重启后的重复任务和补偿策略
- [ ] 失败任务可查询、重试，重复执行具备幂等边界
- [ ] 定时任务、Agent 运行和队列失败事件已接入告警通道

## 运行与回滚

- [ ] `/health` 和 `/health/ready` 均符合容器探针预期
- [ ] `/metrics` 已接入 Prometheus，关键指标已有告警阈值
- [ ] 数据库、Redis、向量索引和对象存储完成备份与恢复演练
- [ ] 已完成压测，记录并发、P95/P99 延迟、错误率和容量上限
- [ ] 已验证灰度、回滚、迁移失败和依赖服务不可用时的降级路径

## 外部依赖（需要线上环境或外部契约）

- [ ] Grafana／告警平台地址、保留周期、通知渠道和责任人
- [ ] 生产机器、域名、证书、WAF、备份策略和发布权限
- [ ] 真实低代码平台的组件、页面、接口和埋点 Schema 契约
- [ ] 企业 IAM／DLP／客服工单／企业微信或 Webhook 凭据
- [ ] 真实业务评测集、组织权限数据和压测窗口
