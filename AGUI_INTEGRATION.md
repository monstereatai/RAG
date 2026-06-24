# AG-UI 流式问答接入说明

## 目标

项目当前有两条 AG-UI 流式问答链路：

- 用户端：`frontend` 直接调用 `rag-backend` 的用户级 AG-UI 接口。
- 管理后台：`admin` 先调用 `admin-backend`，再由 `admin-backend` 用内部服务 token 代理到 `rag-backend`。

## 接口

| 场景 | 前端入口 | 后端入口 | 鉴权 |
| --- | --- | --- | --- |
| 用户端聊天 | `/api/v1/agui/stream` | `backend/src/modules/agui` | 用户 JWT |
| 管理后台 AI 问答 | `/api/admin/qa-ops/agui/stream` | `admin-backend/src/modules/qa-ops` | 管理后台 JWT |
| 内部服务转发 | `/api/v1/agui/admin/stream` | `backend/src/modules/agui` | `RAG_SERVICE_TOKEN` |

## 本地启动顺序

1. 启动 RAG 基础设施。

```bash
cd docker
docker compose up -d
```

2. 启动 rag-backend。

```bash
cd backend
pnpm install
RAG_SERVICE_TOKEN=local-rag-service-token pnpm run start:dev
```

3. 启动 admin-backend。

```bash
cd admin-backend
npm install
RAG_SERVICE_BASE_URL=http://localhost:3000/api/v1 \
RAG_SERVICE_TOKEN=local-rag-service-token \
npm run start:dev
```

4. 启动管理后台。

```bash
cd admin
pnpm install
pnpm run dev
```

## 验证路径

1. 登录管理后台。
2. 打开 `AI问答` 页面。
3. 选择 `agentic` / `auto` / `simple`。
4. 输入问题并发送。
5. 页面应逐步展示：
   - AG-UI 事件轨迹
   - token 增量内容
   - 引用文档
   - route
   - retrieval sufficiency
   - confidence / retry count
   - error state

## 当前限制

- 浏览器原生 `EventSource` 不能携带自定义 header，所以管理后台前端使用 `?token=` 把后台 JWT 传给 admin-backend。
- admin-backend 验证用户 JWT 后，再用 `RAG_SERVICE_TOKEN` 调用 rag-backend；不要让浏览器直接持有 `RAG_SERVICE_TOKEN`。
- `LANGSMITH_TRACING=true` 负责 LangChain/DeepAgents trace；`LANGSMITH_UPLOAD=true` 可让 `backend` 的 `pnpm run eval:rag:langsmith` 额外上传 Dataset / Experiment 数据。CI 严格门禁再开启 `LANGSMITH_UPLOAD_REQUIRED=true`。

## 验证命令

```bash
cd backend && pnpm run build
cd backend && pnpm test -- agui.service.spec.ts --runInBand
cd backend && pnpm run eval:rag:langsmith
cd admin-backend && npm run build
cd admin-backend && npm test -- --runInBand
cd admin && pnpm run lint
```

`admin` 的生产构建需要没有正在运行的 Umi/Utoo dev server 持有 `.turbopack/lock`。
