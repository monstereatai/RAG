# RAG 知识库系统

企业级 Hybrid RAG（混合检索增强生成）与 Agentic RAG（智能体式检索增强生成）Web 应用，具备 **JWT 安全防护** 与 **多租户物理／逻辑数据硬隔离** 能力。

当前项目基于 NestJS、LangChain.js、LangGraph.js、deepagents、Milvus、PostgreSQL、Redis、React 和 Vite 进行构建。

---

## 当前状态

- 项目阶段、已完成事项、待办、阻塞和最近验证统一维护在 [ROADMAP.md](./ROADMAP.md)。
- 系统运行与交付边界见[项目运行、安全与交付](./docs/OPERATIONS.md)；架构设计见[系统架构](./docs/architecture/ARCHITECTURE.md)。

整体规划见[系统架构](./docs/architecture/ARCHITECTURE.md)。

---

## 快速启动

### 前置要求

- **Node.js ≥ 22**（管理后台要求 Node ≥ 22，项目根目录包含 `.nvmrc` / `.node-version` 约束，`nvm use` 自动切换）
- **包管理器**：根目录统一使用 pnpm 10.17.1；子项目保留独立配置以兼容单独启动
- **Docker**（用于基础设施：PostgreSQL、Redis、Milvus 等）

### Workspace（推荐入口）

根目录通过 pnpm workspace 纳管 `apps/rag-api`、`apps/admin-api`、`apps/admin-web`、`apps/user-web`、`packages/rag-cli` 和 `packages/rag-mcp-server`。首次安装和日常开发优先在根目录执行：

```bash
pnpm install
pnpm workspace:list
pnpm dev
```

按服务启动或执行检查：

```bash
pnpm dev:backend       # RAG API
pnpm dev:admin-backend # Agent 运营后台 API
pnpm dev:admin         # 管理后台
pnpm dev:frontend      # 用户前台
pnpm dev:mcp           # RAG MCP Server（stdio）
pnpm build
pnpm test
pnpm typecheck
```

`pnpm dev` 会同时启动后端、管理后台 API、管理后台前端和用户前台；基础设施仍需先按下方 Docker 步骤启动。

### 1. 启动本地 Docker 项目
```bash
docker compose -p docker \
  --env-file "$HOME/Library/Application Support/RAG/langfuse.secrets" \
  -f infra/docker/docker-compose.dev.yml \
  -f infra/docker/docker-compose.langfuse.yml up -d
docker compose -p docker \
  --env-file "$HOME/Library/Application Support/RAG/langfuse.secrets" \
  -f infra/docker/docker-compose.dev.yml \
  -f infra/docker/docker-compose.langfuse.yml ps
```

RAG 与 Langfuse 现在显示在同一个 `docker` Compose 项目下；两者仍使用独立的数据库、缓存、对象存储和数据卷。RAG PostgreSQL 暴露在本机 `5433`，用于避开本机已占用的 `5432`。停止服务时不要添加 `-v`，否则会删除持久数据。生产和 Staging 编排仍保留各自的高可用重启策略。

### 2. 启动后端服务
```bash
cd apps/rag-api
npm install
# 启动 NestJS 开发服务（包含 watch 监听）
npm run start:dev
```

### 3. 启动前端服务
```bash
cd apps/user-web
npm install
npm run dev
```

### 4. 访问服务地址
* **前端开发面板**：http://localhost:5173
* **后端健康检查**：http://localhost:3000/api/health
* **Nginx 生产反代（如容器运行）**：http://localhost:80

---

## 测试账号与使用指南

多租户系统预置了两个测试账号供验证使用：

| 角色 | 用户名 | 密码 | 物理隔离 UserId |
| :--- | :--- | :--- | :--- |
| **管理员 (Admin)** | `admin` | `admin123` | `1` |
| **普通用户 (User)** | `user` | `user1234` | `2` |

### 隔离特性验证步骤：
1. 访问 http://localhost:5173，展现现代磨砂登录界面。
2. 使用右下角快速通道点击 **管理员 (admin)** 登录，上传一份特有文件 A，并在聊天页面针对 A 的核心秘密进行提问。RAG 能成功匹配知识库并回复。
3. 点击顶部右侧 **注销**，切换为 **普通用户 (user)** 登录。
4. 切换到文档页面，您将**看不到**管理员上传的文档 A。
5. 切换到对话页面并对相同隐私问题提问，验证文档列表、检索引用和会话记录均无法跨用户／租户读取。该本地冒烟只覆盖样例路径，不替代生产环境的全资源权限矩阵验收。

---

## 核心 API 接口

> 注：除登录、注册、健康检查和显式标为公开的接口外，其它接口默认必须附带 `Authorization: Bearer <token>` 请求头。浏览器原生 EventSource 需先调用 `POST /api/v1/auth/sse-ticket` 换取一次性短票据，再通过 `?ticket=<ticket>` 建立 SSE 连接。

* **认证模块**
  * `POST /api/auth/login`：用户登录获取 JWT 访问 Token
  * `GET /api/auth/profile`：获取当前登录用户的 Profile 详情
* **文档管理（按租户与资源 ACL 隔离）**
  * `POST /api/documents/upload`：上传并解析文档，字段名 `file`，支持 `.md/.txt/.pdf/.docx`
  * `GET /api/documents`：列出当前用户的所有文档
  * `GET /api/documents/:docId`：查询当前用户拥有的单篇文档详情
  * `DELETE /api/documents/:docId`：同步删除文档元数据、Milvus 分片及内存 BM25 索引
* **聊天与检索（按租户、会话所有权与证据 ACL 隔离）**
  * `POST /api/chat`：非流式聊天兼容入口（内部仍走统一意图路由）
  * `GET /api/chat/stream?query=...&mode=...&threadId=...`：流式 SSE 聊天推送事件链
  * `GET /api/agui/stream?query=...&mode=...&threadId=...`：AG-UI 协议流式问答（用户端）
  * `GET /api/agui/admin/stream?query=...&mode=...&userId=...`：AG-UI 内部服务流式问答（管理后台代理使用，需 `RAG_SERVICE_TOKEN`）
  * `GET /api/chat/conversations`：获取用户的会话历史列表
  * `GET /api/chat/conversations/:threadId`：获取单条会话及详细消息历史
  * `DELETE /api/chat/conversations/:threadId`：删除会话并失效 Redis 中的缓存
* **调试与可观测**
  * `GET /api/debug/chunks?query=...`：查看当前查询在检索召回时的 BM25 分、余弦分及融合加权总分

Agent 运行时、人工审批和任务治理说明见 [Agent Runtime](./docs/AGENT_RUNTIME.md)。

---

## 验证与测试命令

### 1. 代码规范与编译
* **后端构建与排查**：
  ```bash
  cd apps/rag-api
  npm run build
  npm run lint
  npm run eval:rag:quality
  ```
* **前端编译**：
  ```bash
  cd apps/user-web
  npm run build
  ```

### 2. 独立 golden set 检索评测

仓库内提供一套可重复生成的**合成独立 golden set**，覆盖召回、引用、拒答、版本冲突和延迟指标：

```bash
pnpm --filter backend run eval:golden:generate
pnpm --filter backend run eval:golden:check
```

启动后端并配置好模型/索引后运行：

```bash
pnpm --filter backend run eval:golden:live
```

该数据集明确标记为 `synthetic: true`，只能用于回归脚本验证，不能作为真实企业效果或生产验收材料。真实私有数据请按同一 schema 替换 `PROJECT_EVAL_DATASET` 后再运行 live 评测。

### 3. Langfuse 可观测性回归数据集

新增 19 个场景、14 个测试方向的 Langfuse 观测回归集：

```bash
pnpm --filter backend run eval:langfuse:generate
pnpm --filter backend run eval:langfuse:check
pnpm --filter backend run eval:langfuse:dataset
pnpm --filter backend run eval:langfuse:experiment
```

`eval:langfuse:dataset` 使用本地 mock ingestion endpoint 验证真实 `LangfuseProvider` 的 trace/generation/span 序列化、token/cost、脱敏、工具事件、生产工作流、定时分析和禁用契约，不依赖 Langfuse 云端账号。
`eval:langfuse:experiment` 会同步合成场景到配置的 Langfuse dataset，执行本地契约回放，并把每条场景的 0/1 分数及整轮通过率写入 Langfuse Experiment；它评估 Provider 序列化契约，不代表云端 ingestion 传输或 RAG 答案质量验收。

可观测性、评测边界和验证入口见 [项目运行、安全与交付](./docs/OPERATIONS.md)；当前验证结论见 [ROADMAP.md](./ROADMAP.md)。

当前验证结论与真实环境边界见 [ROADMAP.md](./ROADMAP.md)，真实 live 性能、故障注入和并发压测仍需在目标环境重新执行。

覆盖方向：

- trace 生命周期与 session/user 分组；
- 单一问答链路：后端用 QueryPlan 做意图识别，内部自动选择快速或深度执行路径；
- routing、retrieval、query plan、sufficiency、rerank、citation、reflection、final span；
- web search 与 tool call 事件；
- 无证据拒答和版本冲突；
- estimated / provider-reported token 与 cost；
- 生产环境脱敏和开发环境原样保留；
- 模型失败、超时和 fallback 路径；
- 生产多 Agent 工作流、审批等待、工具失败与 fallback；
- 定时分析任务；
- 长事件数据压缩；
- 启用 smoke 和禁用/缺 key 的稳定契约。

该数据集是 observability contract regression，不替代 Langfuse 云端真实 trace 验收；真实云端验收仍使用 `smoke:langfuse`。

### 4. 自动化多租户硬隔离 E2E 验证
在基础设施和后端服务启动后，可在后端目录直接运行我们在本地集成的 E2E 自动化交叉隔离验证脚本：
```bash
cd apps/rag-api
node verify-multitenancy.mjs
```
*该脚本会自动以不同账户身份进行文档上传、跨权限读取拦截测试、对话内容物理隔离检索测试并最终清除测试会话及文档，全链路断言校验，若输出 `🏆 ALL MULTI-TENANCY ISOLATION TESTS PASSED SUCCESSFULLY!` 则代表数据隔离完全符合规格。*

---

共享 ACL 回归可在服务启动后运行：

```bash
cd apps/rag-api
RAG_BASE_URL=http://localhost:3000/api/v1 npm run verify:acl
```

## 常见问题与已知限制

1. **debug / traces / metrics 的环境边界**：
   * 非 production 环境默认可用，方便本地和测试排障；
   * production 默认返回 404；如确需在内网观测，显式设置 `ALLOW_DEV_ENDPOINTS=true`，并通过内网网关限制访问。

2. **Milvus 首次检索可能出现 Deadline warning**：
   * 本地 Docker 环境下，由于内存限制或索引加载慢，Milvus 首次 search / warmup 可能触发可配置 timeout warning。
   * **兜底方案**：系统已实现 search/delete/warmup/circuit 可配置超时、短期熔断、active docId 过滤和 BM25 降级，向量异常不会阻塞主问答链路。
   
3. **ASR / TTS 依赖腾讯云密钥**：
   * 腾讯云 TTS→ASR 直连回环、后端 TTS SSE → ASR endpoint smoke 已验证。需要在 `.env` 中配置 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY`；未配置时后端会明确报错并不阻断核心 RAG 进程。

4. **工程质量评分不是 RAG 质量评分**：
   * `eval:rag:maturity` 默认只评价静态工程结构。要把真实私有题集、生产材料等外部输入也纳入硬门禁，设置 `RAG_MATURITY_REQUIRE_EXTERNAL=true`。
   * 要跑更接近真实项目的强制链路评测，先启动后端，再运行 `pnpm --filter backend run eval:rag:release`；缺服务、缺 judge 或评测跳过都会失败。
