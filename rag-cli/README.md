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
rag ask "question" --stream
rag context "coding task" --format json
rag skill match "task"
rag doc list
rag doc task <task-id>
rag workflow list
rag workflow show <thread-id>
rag workflow context <thread-id>
rag admin search --kind popular
rag admin job list
rag admin job executions <job-id>
rag admin job run <job-id>
rag admin job copy <job-id>
rag admin job start <job-id>
rag admin job stop <job-id>
rag graph query "which systems depend on Milvus?"
rag eval status
rag eval run --dataset rag-smoke --mode offline
rag doctor --format json
```

Current backend alignment:

- `rag ask` supports the Karpathy + Obsidian response shape: `answer`, `references`, `retrievalSufficient`, `retrievalReason`, `obsidianPaths`, `mode`, `route`, and `threadId`.
- Markdown output prints the answer first, then retrieval status, sources, and Obsidian paths. JSON output keeps the full backend payload.
- `rag context` first reads debug chunks. If no chunks are returned, it falls back to `ask auto` and only treats the result as usable context when the backend returns references, Obsidian paths, or `retrievalSufficient=true`.
- `rag search` and `rag context` prefer the formal `/rag/search` and `/rag/context` APIs, then conservatively fall back when talking to an older backend.
- `rag ask --stream` consumes backend SSE directly. It does not simulate a typewriter effect on the client.
- `rag admin search`, `rag graph query`, `rag eval status`, and `rag eval run` expose existing backend operation, GraphRAG, and evaluation entrypoints.
- `rag doc list/show/task` exposes only the current user's document lifecycle, review/version/indexing and asynchronous ingest task state.
- `rag workflow list/show/context` reads the current user's production workflow and its approved coding handoff. `context` only succeeds for a completed workflow.
- `rag admin job list/versions/executions` reads versioned scheduled-analysis jobs; `run/copy/start/stop` are still checked by the backend admin role and are not a CLI bypass.
- The CLI does not manage Milvus, databases, production configs, or keys. Current project-level status is recorded in the root `ROADMAP.md`: maturity `93/100`, project RAG eval `28/28`; Milvus runtime timeout remains a backend/runtime blocker.

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
