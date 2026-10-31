# 项目运行、安全与交付

## 1. 进度与规范来源

- 当前实现、最近验证、待办和外部阻塞：根目录 [ROADMAP.md](../ROADMAP.md)。
- API 契约以代码和生成的 OpenAPI 为准；兼容性规则按兼容优先、破坏性变更需版本或迁移说明执行。
- 真实密钥只由部署环境注入，不写入仓库、日志、运行事件或产物。

## 2. 本地运行与部署入口

本地 RAG 与 Langfuse 共用一个 Compose 项目；Langfuse 使用独立网络和持久卷，数据库、Redis、MinIO 与 RAG 的同类服务保持隔离：

```bash
docker compose -p docker \
  --env-file "$HOME/Library/Application Support/RAG/langfuse.secrets" \
  -f infra/docker/docker-compose.dev.yml \
  -f infra/docker/docker-compose.langfuse.yml up -d
docker compose -p docker \
  --env-file "$HOME/Library/Application Support/RAG/langfuse.secrets" \
  -f infra/docker/docker-compose.dev.yml \
  -f infra/docker/docker-compose.langfuse.yml ps
pnpm --dir apps/rag-api run start:dev
```

生产目标是 Docker Compose。上线检查脚本只检查配置和仓库边界，不会代替目标环境验收或执行生产发布：

```bash
./scripts/check-production-readiness.sh
pnpm --dir apps/rag-api run enterprise:readiness
```

生产发布仍需目标机器、域名、证书、密钥注入、备份恢复和回滚策略。不要把本地服务启动或静态 readiness 结果当成生产已就绪。

### Langfuse 本地观测服务

Langfuse 界面地址为 `http://127.0.0.1:3002`。登录与服务密钥保存在仓库外的 owner-only 文件：`$HOME/Library/Application Support/RAG/langfuse.secrets`。

```bash
docker compose -p docker \
  --env-file "$HOME/Library/Application Support/RAG/langfuse.secrets" \
  -f infra/docker/docker-compose.dev.yml \
  -f infra/docker/docker-compose.langfuse.yml stop
```

`stop` 会停止整个本地 Compose 项目并保留数据卷；之后用同一组文件执行 `up -d` 恢复。旧项目首次导入时创建的数据卷保留为离线备份，不再启动。RAG 应用新产生的 trace 仍发往 Langfuse Cloud。

### OpenSandbox Agent 项目工作区

Agent 项目工作区需要单独部署并配置 OpenSandbox Server、兼容的执行镜像，以及 `OPEN_SANDBOX_DOMAIN`、`OPEN_SANDBOX_IMAGE`；启用认证时再注入 `OPEN_SANDBOX_API_KEY`。其余可选配置见 `apps/rag-api/.env.example`。当前 RAG 适配器默认限制为 2 CPU、4 GiB 内存、8 GiB 磁盘和 6 小时绝对寿命；网络默认拒绝，只放行 npm、npmmirror 和阿里云镜像域名。需要其他包源时，通过 `OPEN_SANDBOX_EGRESS_ALLOWLIST` 显式添加。

沙箱不挂载宿主目录，不注入 RAG、数据库、对象存储或模型凭据，也不挂 Docker Socket。Agent 命令最多运行 240 秒，单次输出保留最近 16 KiB；预览票据绑定工作流与端口、5 分钟过期，并只允许 GET/HEAD。项目预览代理不支持 WebSocket，因此 Vite HMR 不可用，修改后需手动刷新。

RAG 当前通过 SDK 配置端点安全访问、CPU、内存、磁盘、绝对寿命和网络策略；PID 上限及底层容器运行参数必须在 OpenSandbox Server/Runtime 部署配置中另行设硬限制。启用前需在目标环境确认这些限制、Server 与 SDK 兼容性、真实 tenant 身份传递、域名路由和包源可达性，并做隔离与超时演练。本地 mock 测试不代表真实 Sandbox 部署验收。

## 3. 依赖与降级边界

项目可能使用 PostgreSQL、Redis／BullMQ、Milvus、Elasticsearch、Neo4j、对象存储及外部模型／检索服务。具体 compose 配置和环境变量模板是实际运行配置的来源。

- 向量检索异常时，配置允许的主链路可快速失败并使用 BM25／全文路径降级；检索状态需保留在运行记录中。
- Web Search、Rerank、图谱等可选能力缺少凭据或不可用时应明确跳过或降级，不得虚报已验证。
- 生产关键队列、共享身份、分布式锁等依赖应按严格配置 fail closed；不能把进程内临时路径当作多实例可靠性。
- 监控指标和 trace 用于定位链路阶段；真实 SLA、容量和告警责任人需由目标环境验收。
- BullMQ 暴露各队列 waiting/active/delayed/failed/completed/paused 状态、最老等待任务年龄、成功/失败尝试事件速率，以及排队等待和单次 Worker 执行 P95；持续采样失败有独立告警。Prometheus 抓取指标仍受 `/api/v1/metrics` 的 `DevOnlyGuard` 保护；生产抓取必须经过内网网关或显式运维鉴权，不能公开开启开发端点。积压与等待时长告警阈值需按真实队列 SLA 和负载校准。

### Mem0 周期归纳

`MEM0_CONSOLIDATION_ENABLED` 默认是 `false`。显式启用后，还要求 `MEM0_ENABLED=true` 和 Redis 可用；每周日 03:00（Asia/Shanghai）通过 Redis 分布式锁处理最多 10 个用户，并用 Redis 游标轮转用户。只有至少 20 条符合条件的长期 user 记忆才会生成草案；原始记忆保持不变，草案以 `infer=false` 保存并等待人工审核。

- `GET /api/v1/memories/consolidations/pending` 查看当前用户的草案及来源原文。
- `POST /api/v1/memories/consolidations/:memoryId/approve` 审批；执行前重新核验全部来源指纹，来源已变化时拒绝审批并将草案标为 stale。
- `POST /api/v1/memories/consolidations/:memoryId/reject` 驳回草案；不删除草案或来源记忆。
- `POST /api/v1/memories/consolidations/:memoryId/revoke` 撤销已审批摘要；该摘要停止注入，仍保留的来源记忆恢复正常检索。

这些接口继承 `rag:memory` 权限。审批/驳回在 Redis 不可用时 fail closed。`MEM0_CONSOLIDATION_ENABLED` 不应在未验证目标 Mem0 版本、真实记忆质量和数据治理规则前打开；生成草案不会替代真实召回率/污染率评测。

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
