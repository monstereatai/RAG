# RAG 知识库系统

Agentic RAG + Karpathy-style RAG Web 应用，具备企业级 **JWT 安全防护** 与 **多租户物理/逻辑数据硬隔离** 能力。

当前项目基于 NestJS、LangChain.js、LangGraph.js、deepagents、Milvus、PostgreSQL、Redis、React 和 Vite 进行构建。

---

## 当前状态

- **M1 simple RAG 已完成**：支持 Markdown/TXT/PDF/DOCX 文档解析上传、切分、Embedding 向量化、Milvus 向量入库、BM25 + Cosine 混合检索及大模型生成与引用定位。
- **M2 Agentic RAG 已完成**：整合 deepAgent 检索规划、Query 扩展、充分性评估、Bocha 联网搜索兜底、DashScope Rerank 重排序、大模型流式生成、置信度自我评估与重试，支持 SSE 全链路事件流式推送。
- **M3 工程化与多租户隔离已完成**：
  - **JWT 鉴权防护**：对除 `/auth/login` 外的所有 REST 与 SSE 接口覆盖 JWT 验证；
  - **数据硬隔离**：在 PostgreSQL 关系库、Redis 缓存、Milvus 向量存储及内存 BM25 分词索引四大组件中深度引入 `userId` 条件，彻底阻断跨租户的数据交互或隐私泄露。
- **M4 前端 MVP 已完成**：内置精美磨砂玻璃渐变（Glassmorphism）登录/注销卡片，支持文档上传、多模式聊天、流程追踪和 Debug 属性进度条面板。
- **M5 容器化部署已完成**：应用后端与前端 Dockerfile 多阶段瘦身构建，提供 `docker-compose.prod.yml` 完整限制资源的生产编排栈。
- **部署目标**：当前固定为 Docker Compose，见 `DEPLOYMENT.md`。真实生产发布仍需要目标机器、域名、证书、备份和密钥注入策略确认。

详细进度见 [ROADMAP.md](./ROADMAP.md)，整体规划见 [rag-plan.md](./rag-plan.md)。

---

## 快速启动

### 1. 启动基础设施
```bash
cd docker
docker compose up -d
docker compose ps
```

### 2. 启动后端服务
```bash
cd backend
npm install
# 启动 NestJS 开发服务（包含 watch 监听）
npm run start:dev
```

### 3. 启动前端服务
```bash
cd frontend
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
5. 切换到对话页面并进行相同隐私问题的提问，系统检索为空并返回 *“未找到相关内容”*，验证表明 Milvus 及 BM25 过滤均对未授权用户完全不可见，证明物理/逻辑硬隔离已 100% 生效！

---

## 核心 API 接口

> 注：除登录接口外，其它接口必须附带 `Authorization: Bearer <token>` 请求头。对于原生 EventSource（SSE 接口），可以把 token 附带在 query 参数中，例如：`?token=<token>`。

* **认证模块**
  * `POST /api/auth/login`：用户登录获取 JWT 访问 Token
  * `GET /api/auth/profile`：获取当前登录用户的 Profile 详情
* **文档管理（按 userId 隔离）**
  * `POST /api/documents/upload`：上传并解析文档，字段名 `file`，支持 `.md/.txt/.pdf/.docx`
  * `GET /api/documents`：列出当前用户的所有文档
  * `GET /api/documents/:docId`：查询当前用户拥有的单篇文档详情
  * `DELETE /api/documents/:docId`：同步删除文档元数据、Milvus 分片及内存 BM25 索引
* **聊天与检索（按 userId 隔离）**
  * `POST /api/chat`：非流式聊天（常用于 simple 模式）
  * `GET /api/chat/stream?query=...&mode=...&threadId=...`：流式 SSE 聊天推送事件链
  * `GET /api/chat/conversations`：获取用户的会话历史列表
  * `GET /api/chat/conversations/:threadId`：获取单条会话及详细消息历史
  * `DELETE /api/chat/conversations/:threadId`：删除会话并失效 Redis 中的缓存
* **调试与可观测**
  * `GET /api/debug/chunks?query=...`：查看当前查询在检索召回时的 BM25 分、余弦分及融合加权总分

---

## 验证与测试命令

### 1. 代码规范与编译
* **后端构建与排查**：
  ```bash
  cd backend
  npm run build
  npm run lint
  ```
* **前端编译**：
  ```bash
  cd frontend
  npm run build
  ```

### 2. 自动化多租户硬隔离 E2E 验证
在基础设施和后端服务启动后，可在后端目录直接运行我们在本地集成的 E2E 自动化交叉隔离验证脚本：
```bash
cd backend
node verify-multitenancy.mjs
```
*该脚本会自动以不同账户身份进行文档上传、跨权限读取拦截测试、对话内容物理隔离检索测试并最终清除测试会话及文档，全链路断言校验，若输出 `🏆 ALL MULTI-TENANCY ISOLATION TESTS PASSED SUCCESSFULLY!` 则代表数据隔离完全符合规格。*

---

## 常见问题与已知限制

1. **Milvus 首次检索可能出现 Deadline warning**：
   * 本地 Docker 环境下，由于内存限制或索引加载慢，Milvus 首次 search / warmup 可能触发可配置 timeout warning。
   * **兜底方案**：系统已实现 search/delete/warmup/circuit 可配置超时、短期熔断、active docId 过滤和 BM25 降级，向量异常不会阻塞主问答链路。
   
2. **ASR / TTS 依赖腾讯云密钥**：
   * 腾讯云 TTS→ASR 直连回环、后端 TTS SSE → ASR endpoint smoke 已验证。需要在 `.env` 中配置 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY`；未配置时后端会明确报错并不阻断核心 RAG 进程。
