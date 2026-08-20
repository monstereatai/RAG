# 生产部署 Checklist

> 日期：2026-06-30 | 状态：模板 | 用途：部署前逐项确认

## 前置准备

### 1. 基础设施

- [ ] 目标机器 OS / Kernel / 架构确认
- [ ] Docker + Docker Compose 安装 (>= 24.0)
- [ ] Node.js >= 22（管理后台要求 Node 22+）
- [ ] 至少 8GB 可用内存（Milvus + ES + Neo4j 较重）
- [ ] 磁盘空间：至少 50GB（含 Milvus 索引、ES 数据、Neo4j 数据）

### 2. 外部依赖清单

| 依赖 | 说明 | 是否需要 Key |
|------|------|-------------|
| PostgreSQL | 主数据库 | 否 |
| Milvus | 向量数据库（主） | 否 |
| Elasticsearch | 全文检索 | 否 |
| Neo4j | 图谱数据库 | 否 |
| Redis | 缓存/短期记忆/队列 | 否 |
| MinIO | 对象存储（可选） | 否 |
| Qwen API | 默认 LLM | **是** `QWEN_API_KEY` |
| DeepSeek API | 可选 LLM | 可选 `DEEPSEEK_API_KEY` |
| Bocha API | Web 搜索工具 | **是** `BOCHA_API_KEY` |
| DashScope Rerank | 语义重排 | 可选 |
| Mem0 | 长期记忆 | 可选 |
| LangFuse | 可观测（线上） | 可选 |
| Tencent ASR/TTS | 语音识别/合成 | 可选 |

### 3. 域名 & 网络

- [ ] 域名已解析到目标机器 IP
- [ ] SSL 证书已配置（Let's Encrypt / 商业证书）
- [ ] 反向代理已配置（Nginx / Caddy / Traefik）
- [ ] 防火墙放开 80/443（公网）、内部服务端口（内网）

---

## 部署步骤

### Step 1: 克隆代码 & 配置环境

```bash
git clone <repo-url> /opt/rag
cd /opt/rag
cp backend/.env.example backend/.env
# 编辑 .env，填入真实 key 和连接信息
```

### Step 2: 启动基础设施

```bash
cd docker
# 按需修改 docker-compose.yml 中的端口映射和数据卷
docker compose up -d postgres milvus redis elasticsearch neo4j
# 等待所有服务 health check 通过
docker compose ps
```

### Step 3: 构建 & 启动后端

```bash
cd backend
npm ci
npm run build
# 确保 .env 已配置且服务连接正常
NODE_ENV=production node dist/src/main.js
```

### Step 4: 构建 & 启动管理后台后端

```bash
cd admin-backend
npm ci
npm run build
NODE_ENV=production node dist/main.js
```

### Step 5: 构建 & 启动管理后台前端

```bash
cd admin
# 配置 .env 中的 API 地址
npm ci
npm run build
# 用 nginx 托管 dist/ 目录
```

---

## 启动后验证

```bash
# 1. 健康检查
curl https://<domain>/api/v1/health

# 2. 能力检查
curl https://<domain>/api/v1/rag/admin/capabilities \
  -H "Authorization: Bearer <admin-token>"

# 3. 向量检索状态
curl https://<domain>/api/v1/rag/admin/vector-index \
  -H "Authorization: Bearer <admin-token>"

# 4. 文档上传 + 检索测试
# 5. 管理后台登录
```

---

## 生产关键配置

### Nginx 反向代理示例

```nginx
server {
    listen 443 ssl;
    server_name rag.example.com;

    ssl_certificate /etc/ssl/certs/rag.example.com.pem;
    ssl_certificate_key /etc/ssl/private/rag.example.com.key;

    # 管理后台前端
    location / {
        proxy_pass http://127.0.0.1:8000;
    }

    # RAG API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # SSE 支持
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding on;
        proxy_buffering off;
        proxy_cache off;
    }

    # TTS WebSocket
    location /api/v1/speech/tts/ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 数据备份

- **PostgreSQL**: `pg_dump` + 定时任务每日备份
- **Milvus**: 定期导出向量索引 + 元数据库备份
- **Neo4j**: dump 命令备份
- **Elasticsearch**: snapshot API
- **Redis**: RDB/AOF 持久化
- **对象存储**（MinIO / 本地文件）: rsync 到异地

### 监控告警

- 服务存活：定时 curl /api/v1/health
- 磁盘使用率：> 80% 告警
- Milvus 熔断状态：检查 /api/v1/rag/admin/vector-index
- LLM 调用失败率：> 5% 告警
- 搜索 P99 延迟：> 5s 告警

---

## 部署脚本

同级目录下的 `scripts/deploy.sh` 提供一键部署模板（需按实际环境修改）。

## 风险 & 回滚

- 数据库 schema 变更（TypeORM synchronize）生产应关闭
- 部署前备份数据库
- 保留上一个版本的 Docker image 或 dist 目录
- 服务发现用反向代理，切换版本只需 reload nginx
