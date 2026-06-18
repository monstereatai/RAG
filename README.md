# RAG

Agentic RAG + Karpathy-style RAG Web 应用。

当前项目使用 NestJS、LangChain.js、LangGraph.js、deepagents、Milvus、React 和 Vite。`agent-course/` 是参考代码目录，只读，不属于主项目源码。

## 当前状态

- M1 simple RAG 已完成：上传 Markdown/TXT/PDF/DOCX、切分、Embedding、写入 Milvus、BM25 + cosine 混合检索、回答与引用。
- M2 Agentic RAG 已完成：deepAgent 检索规划、query augment、retrieval、流式生成、reflection、auto 路由、SSE 全事件。
- M3 工程化已完成：JWT、统一响应、全局异常、参数校验、pino 日志。
- M4 前端 MVP 已完成：上传页、聊天页、引用展示、模式切换、SSE 流式显示、浏览器语音输入。
- M5 容器化已完成：后端/前端 Dockerfile、prod compose、nginx 反代。

详细进度见 [ROADMAP.md](./ROADMAP.md)，规划见 [rag-plan.md](./rag-plan.md)。

## 快速启动

启动基础设施：

```bash
cd docker
docker compose up -d
docker compose ps
```

启动后端：

```bash
cd backend
npm install
npm run start
```

启动前端：

```bash
cd frontend
npm install
npm run dev
```

默认地址：

- 后端健康检查：http://localhost:3000/api/health
- 前端开发服务：http://localhost:5173
- 前端生产反代：http://localhost:80

## 核心接口

- `GET /api/health`：健康检查。
- `POST /api/auth/login`：测试登录。
- `GET /api/auth/profile`：JWT profile。
- `POST /api/documents/upload`：上传文档，字段名 `file`，支持 `.md` / `.markdown` / `.txt` / `.pdf` / `.docx`。
- `GET /api/documents`：文档列表。
- `POST /api/chat`：非流式聊天，body 使用 `query` 和 `mode`。
- `GET /api/chat/stream?query=...&mode=agentic`：SSE 流式聊天。
- `GET /api/debug/chunks?query=...`：查看 BM25、cosine、融合分数。

聊天模式：

- `simple`：Karpathy-style RAG。
- `agentic`：deepAgent 规划 + 检索 + 生成 + reflection。
- `auto`：先判断复杂度，再选择 simple 或 agentic。

SSE 事件：

- `routing`
- `query_augment`
- `retrieval`
- `sufficiency`
- `web_search`
- `rerank`
- `token`
- `citation`
- `reflection`
- `final`
- `error`

## 验证命令

后端：

```bash
cd backend
npm run build
npx eslint "{src,apps,libs,test}/**/*.ts"
```

前端：

```bash
cd frontend
npm run build
```

M2 手动验证示例：

```bash
curl -sS -F "file=@/tmp/rag-m2-test.md" http://localhost:3000/api/documents/upload

curl -sS -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"query":"这个项目用了哪些技术栈，它们分别负责什么？","mode":"auto"}'

curl -N "http://localhost:3000/api/chat/stream?query=M2%20Agentic%20RAG%20%E7%9A%84%20SSE%20%E9%9C%80%E8%A6%81%E8%BE%93%E5%87%BA%E5%93%AA%E4%BA%9B%E4%BA%8B%E4%BB%B6%EF%BC%9F&mode=agentic"
```

## 已知问题

Milvus `search` 在本机 Docker 环境仍可能出现 15s timeout。当前实现会在向量检索失败时降级到 BM25，并通过中文单字/bigram 兜底保证中文查询可召回，因此 M2 功能不再被阻塞。

后续优化方向：

- 调整 Milvus 索引和 query node 资源配置。
- 尝试 HNSW 或升级 Milvus 版本。
- 接入 Elasticsearch 作为稳定关键词检索层。
- 接入 DashScope Rerank 提升最终引用质量。
