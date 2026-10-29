# 项目运行、安全与交付

## 1. 进度与规范来源

- 当前实现、最近验证、待办和外部阻塞：根目录 [ROADMAP.md](../ROADMAP.md)。
- API 契约以代码和生成的 OpenAPI 为准；兼容性规则按兼容优先、破坏性变更需版本或迁移说明执行。
- 真实密钥只由部署环境注入，不写入仓库、日志、运行事件或产物。

## 2. 本地运行与部署入口

本地开发基础设施：

```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d
pnpm --dir apps/rag-api run start:dev
```

生产目标是 Docker Compose。上线检查脚本只检查配置和仓库边界，不会代替目标环境验收或执行生产发布：

```bash
./scripts/check-production-readiness.sh
pnpm --dir apps/rag-api run enterprise:readiness
```

生产发布仍需目标机器、域名、证书、密钥注入、备份恢复和回滚策略。不要把本地服务启动或静态 readiness 结果当成生产已就绪。

## 3. 依赖与降级边界

项目可能使用 PostgreSQL、Redis／BullMQ、Milvus、Elasticsearch、Neo4j、对象存储及外部模型／检索服务。具体 compose 配置和环境变量模板是实际运行配置的来源。

- 向量检索异常时，配置允许的主链路可快速失败并使用 BM25／全文路径降级；检索状态需保留在运行记录中。
- Web Search、Rerank、图谱等可选能力缺少凭据或不可用时应明确跳过或降级，不得虚报已验证。
- 生产关键队列、共享身份、分布式锁等依赖应按严格配置 fail closed；不能把进程内临时路径当作多实例可靠性。
- 监控指标和 trace 用于定位链路阶段；真实 SLA、容量和告警责任人需由目标环境验收。

## 4. 身份、安全与数据生命周期

- HTTP API 默认受认证与授权保护，公开接口显式声明；SSE 使用短期票据，不在 URL 携带长期 JWT。
- 数据读取同时受 tenant、用户所有权和资源 ACL 约束；生产隔离仍需真实 IAM 配置及跨租户验证。
- Prompt、工具结果和检索文档均视为不可信输入；工具调用还要经过权限、Schema、风险和预算控制。
- 查询日志、trace、Artifact 和事件 payload 不应持久化密钥或不必要的敏感原文；保留期与脱敏配置应在目标环境审查。
- 数据库 schema 变更、迁移和数据回填按项目授权流程单独处理，不通过文档整理隐式执行。

## 5. 集成与通知

MCP、飞书 Wiki、Team Wiki、Domain Event Outbox 和 Webhook 是可选集成面。凭据由 Backend 环境配置持有；同步与发布使用既有文档权限、生命周期和来源检查。外部推送失败不应回滚已完成的主业务，失败事件应能查询并按幂等边界重试。

## 6. 验证入口

按改动范围选择 build、lint、定向测试、smoke、OpenAPI 合约、RAG／Agent 评测和生产 readiness。完整命令见根目录 `CLAUDE.md` 与 `apps/rag-api/package.json`；真实 RAG 改动还要依照项目规则通过统一入口验证快速路径和深度路径。任何未运行或环境不可用的检查都应明确标为未验证。
