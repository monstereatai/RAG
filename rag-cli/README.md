# RAG CLI

Command line gateway for querying a RAG knowledge service, asking questions, and producing coding context packages for humans, scripts, agents, and skills.

中文使用说明见 [USAGE.zh-CN.md](./USAGE.zh-CN.md)。

产品和架构文档：

- [docs/CLI_PRD.md](./docs/CLI_PRD.md)
- [docs/CLI_ARCHITECTURE.md](./docs/CLI_ARCHITECTURE.md)
- [docs/CLI_ROADMAP.md](./docs/CLI_ROADMAP.md)

## Install

```bash
pnpm install
pnpm run build
```

Run locally:

```bash
node dist/src/bin.js --help
```

## Configure

Initialize local config:

```bash
node dist/src/bin.js init
```

Login:

```bash
node dist/src/bin.js auth login --base-url http://localhost:3000/api/v1 --username admin
```

Machine mode can avoid prompts:

```bash
printf '%s' "$RAG_PASSWORD" | node dist/src/bin.js auth login --username admin --format json
```

Environment overrides:

```bash
RAG_BASE_URL=http://localhost:3000/api/v1
RAG_TOKEN=...
```

Saved config path:

```text
~/.config/rag-cli/config.json
```

The config file is written with user-only permissions. Passwords are never saved.

## Commands

```bash
rag init
rag auth login
rag auth status
rag auth logout
rag config get
rag config set baseUrl http://localhost:3000/api/v1
rag search "query"
rag ask "question" --mode auto
rag context "coding task" --format json
rag skill match "task"
rag doc list
rag doctor --format json
```

## Output Contract

JSON mode is for scripts and agents:

```bash
rag context "fix citation failures" --format json
```

Rules:

- stdout contains only JSON.
- spinners and colors are disabled.
- prompts are disabled.
- failures include stable `error.code`, `error.message`, and `error.recoverable`.

## Security Boundaries

- The CLI only calls RAG backend APIs.
- The CLI does not read or write `.env`.
- The CLI does not access PostgreSQL, Milvus, Redis, Elasticsearch, or Neo4j directly.
- The CLI does not publish, deploy, commit, push, or modify production configuration.
- Tokens are masked in config output and never printed by default.

## Verification

```bash
pnpm run build
pnpm test
node dist/src/bin.js --help
node dist/src/bin.js doctor --format json --base-url http://127.0.0.1:9/api/v1 --timeout 500
```
