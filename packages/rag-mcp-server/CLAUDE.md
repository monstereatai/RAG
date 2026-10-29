# RAG MCP 服务项目规则

> 本目录是给 AI 编程工具使用的 MCP 服务，不是 RAG 后端，也不是 CLI 的替代品。

## 项目定位

`packages/rag-mcp-server` 是 Agent 工具入口，支持本地 stdio 与受控的 Streamable HTTP 接入：

- Codex / Trae / Claude Code / Cursor 等本机 MCP 客户端通过 stdio 调用本服务。
- 团队远程 MCP 客户端通过 Streamable HTTP 调用时，必须携带 RAG JWT/API Token；服务校验调用方后将原 Bearer Token 逐请求透传给 RAG 后端，由后端执行租户、IAM 与 API scope 校验。
- HTTP transport 只暴露显式 allowlist 中的工具，并按已验证的 tenant/user 做速率限制；不得回退到进程级静态凭据。
- 本服务只访问 RAG 后端 HTTP API，不直接访问数据库、Milvus、Redis、Neo4j 或 `.env`。
- CLI 继续面向人、脚本、CI、批量导入和批量评测；MCP 面向 Agent 自动取上下文。

## 目录约定

```text
packages/rag-mcp-server/
├── src/
│   ├── config.ts
│   ├── errors.ts
│   ├── game-tools.ts
│   ├── rag-api-client.ts
│   ├── server.ts
│   ├── http-auth-context.ts
│   └── http-server.ts
├── test/
└── README.md
```

- `server.ts` 注册 MCP 工具；默认入口仍使用 stdio transport。
- `http-server.ts` 提供受控 Streamable HTTP transport；调用身份按请求隔离，不保存或记录 token。
- `http-auth-context.ts` 只在当前异步请求内提供待透传的 Bearer Token。
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
- MCP Server 不直接访问数据库、修改数据库 schema/migration、改 CI/CD 或生产配置。
- HTTP MCP 不得使用静态共享用户凭据替代每次请求的调用方身份。
- 不做 npm publish。
- 不自动改代码、commit、push 或部署。
