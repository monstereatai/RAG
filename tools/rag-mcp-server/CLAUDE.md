# CLAUDE.md — RAG MCP Server 项目规则

> 本目录是给 AI 编程工具使用的 MCP 服务，不是 RAG 后端，也不是 CLI 的替代品。

## 项目定位

`rag-mcp-server` 是 Agent 工具入口：

- Codex / Trae / Claude Code / Cursor 等 MCP 客户端通过 stdio 调用本服务。
- 本服务只访问 RAG 后端 HTTP API，不直接访问数据库、Milvus、Redis、Neo4j 或 `.env`。
- CLI 继续面向人、脚本、CI、批量导入和批量评测；MCP 面向 Agent 自动取上下文。

## 目录约定

```text
tools/rag-mcp-server/
├── src/
│   ├── config.ts
│   ├── errors.ts
│   ├── game-tools.ts
│   ├── rag-api-client.ts
│   └── server.ts
├── test/
└── README.md
```

- `server.ts` 只注册 MCP 工具和 stdio transport。
- `rag-api-client.ts` 统一处理 HTTP、鉴权、超时和响应解包。
- `game-tools.ts` 只负责游戏活动/官网营销业务 prompt 编排。
- `config.ts` 只读环境变量和 `rag-cli` 用户配置，不写配置文件。

## 配置来源

优先级从高到低：

1. `RAG_MCP_BASE_URL` / `RAG_MCP_TOKEN`
2. `RAG_BASE_URL` / `RAG_TOKEN`
3. `~/.config/rag-cli/config.json`
4. 默认 `http://localhost:3000/api/v1`

## 验证命令

```bash
pnpm run build
pnpm test
node dist/src/server.js --help
```

## 红线

- 不写 `.env`。
- 不输出 token 原文。
- 不改数据库 schema、migration、CI/CD、生产配置。
- 不做 npm publish。
- 不自动改代码、commit、push 或部署。
