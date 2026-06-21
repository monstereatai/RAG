# RAG Deployment

`ROADMAP.md` 当前部署目标固定为 Docker Compose。不要直接在本机执行生产发布；生产发布需要目标机器、域名、证书、备份和密钥注入策略确认。

## Local Development

```bash
docker compose -f docker/docker-compose.dev.yml --profile graphrag up -d
cd backend
PORT=3001 GRAPH_RAG_ENABLED=true NEO4J_PASSWORD=neo4jpassword npm run start:dev
```

验证：

```bash
curl http://localhost:3001/api/v1/health
cd backend
npm run smoke:graph
npm run smoke:hybrid
npm run smoke:redis-checkpointer
npm run eval:rag:e2e
npm run mcp:validate
npm run graph:import-business -- --dry-run
npm run smoke:external
```

## Staging

```bash
docker compose -f docker/docker-compose.staging.yml --profile graphrag config
docker compose -f docker/docker-compose.staging.yml --profile graphrag up -d --build
docker compose -f docker/docker-compose.staging.yml --profile graphrag ps
```

## Production Compose Target

生产目标采用单机 Docker Compose：

```bash
docker compose -f docker/docker-compose.prod.yml --profile graphrag config
docker compose -f docker/docker-compose.prod.yml --profile graphrag up -d --build
docker compose -f docker/docker-compose.prod.yml --profile graphrag ps
```

上线前必须确认：

- `backend/.env` 只在目标机器本地注入，不进 git。
- PostgreSQL、Milvus、MinIO、Redis、Neo4j volumes 有备份策略。
- 对外入口只暴露 frontend/nginx，后台服务端口按目标网络策略限制。
- `GRAPH_RAG_ENABLED=true` 时必须设置 `NEO4J_PASSWORD`。
- Bocha / Rerank key 缺失时对应增强能力会跳过，不阻塞主 RAG。

上线前只做检查、不发布：

```bash
./scripts/check-production-readiness.sh
cd backend
npm run smoke:external:required
```

`smoke:external:required` 会真实调用 Bocha Web Search、DashScope Rerank 和 Qwen judge；任一 key 缺失或接口失败都会让检查失败。

## Business Data Handoff

真实业务数据不要直接塞进聊天或提交到 git。建议流程：

```bash
cd backend
npm run eval:business-import -- --input /path/to/private-business-regression.json
npm run eval:business-import -- --input /path/to/private-business-regression.json --write --min-cases 100
npm run eval:rag:quality
```

GraphRAG 业务图谱种子：

```bash
cd backend
GRAPH_BUSINESS_SEED=/path/to/private-graph-seed.json npm run graph:import-business -- --dry-run
GRAPH_RAG_ENABLED=true GRAPH_BUSINESS_SEED=/path/to/private-graph-seed.json npm run graph:import-business
```

业务 MCP Server：

```bash
cd backend
MCP_CONFIG_PATH=../workspace/mcp-business.example.yaml npm run mcp:validate
MCP_CONFIG_PATH=/path/to/business-mcp-servers.yaml npm run mcp:validate
```

## Milvus Tuning Notes

当前代码已经把 Milvus search/warmup timeout 和熔断做成可配置，业务链路会降级到 BM25，不阻塞回答。若要继续压低首次向量检索 warning，优先从运行环境处理：

- 给 Milvus/etcd/minio 保留稳定 CPU 和内存，不要和后端 watch 编译抢资源。
- 确认 collection 已建索引并完成 load 后再跑大批量 e2e。
- 本机 Docker 首次启动后先跑一次 `GET /api/v1/debug/vector-index` 和 `npm run smoke:hybrid` 预热。
- 若 warning 仍频繁出现，再调 `MILVUS_WARMUP_TIMEOUT_MS`、`MILVUS_SEARCH_TIMEOUT_MS`、`MILVUS_CIRCUIT_BREAKER_MS`，不要把业务答案正确性押在单一路径向量召回上。
