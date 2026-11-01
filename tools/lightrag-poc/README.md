# LightRAG isolated POC (no production wiring)

Purpose: measure whether LightRAG's graph-enhanced context retrieval helps this repository's game-rule and cross-document questions **before** replacing the existing `GraphService`/Neo4j implementation. The current NestJS `RagRetrievalService`, document ingestion, permissions, lifecycle filtering and user-facing endpoints are **unchanged**.

## Safety boundaries

- Use a **separate** self-hosted LightRAG instance and **dedicated disposable workspace**, populated ONLY with synthetic or explicitly approved test data. Never point this at the production knowledge corpus.
- This POC does **not** enforce the repository's document-level ACL, tenant filters, effective-time rules, or version visibility. Do NOT wire `queryContext()` into the end-user RAG path. LightRAG workspaces are not equivalent to these policies.
- An API key is required. Deploy LightRAG with auth enabled, bind it to localhost or a private trusted network, and restrict access to its APIs and WebUI.
- Test insertion requires a separate explicit acknowledgement. The default command is read-only. Benchmark errors do not expose response bodies or keys.

## Start a separate LightRAG instance

Follow the [official server guide](https://github.com/HKUDS/LightRAG/blob/main/docs/LightRAG-API-Server.md) and configure a test-only workspace, e.g. `lightrag-server --host 127.0.0.1 --port 9621 --workspace rag-poc-2026`. Configure a suitable extraction LLM and embedding model first, and enable `LIGHTRAG_API_KEY` on the LightRAG server. This repository does not provision or host LightRAG.

### 1. Add synthetic corpus (only once)

```bash
export LIGHTRAG_POC_URL=http://127.0.0.1:9621
export LIGHTRAG_POC_API_KEY='your-test-server-key'
export LIGHTRAG_POC_ISOLATED_WORKSPACE=I_ACKNOWLEDGE_ISOLATED_TEST_DATA
node tools/lightrag-poc/benchmark.mjs --ingest
```

LightRAG's text ingestion is asynchronous. Confirm that all sample documents have finished indexing in the server WebUI or `/documents/track_status/{track_id}`. Avoid re-inserting documents with duplicate filenames; use a fresh disposable workspace to reset the test.

### 2. Compare retrieval modes

```bash
node tools/lightrag-poc/benchmark.mjs --mode naive --out /tmp/lightrag-naive.json
node tools/lightrag-poc/benchmark.mjs --mode local --out /tmp/lightrag-local.json
node tools/lightrag-poc/benchmark.mjs --mode global --out /tmp/lightrag-global.json
node tools/lightrag-poc/benchmark.mjs --mode mix --out /tmp/lightrag-mix.json
```

For a **rough** side-by-side comparison, optionally supply an object mapping case IDs to existing RAG retrieved context strings:

```json
{ "simple-item": "星辰券", "cross-document": "星辰券 每天两次" }
```

```bash
node tools/lightrag-poc/benchmark.mjs --mode mix --baseline ./baseline-contexts.json
```

The metric is *keyword presence in retrieved context*, not a formal `Recall@10`, answer accuracy, ACL proof, or source-citation fidelity. For a production decision, build a real Golden Dataset and compare multi-hop correctness, evidence recall, document-level ACL, effective dates/version semantics, p95 latency, token cost, and deletion/reindex consistency. A high benchmark score alone does not justify migration.

### Test the client (no server required)

```bash
node --test tools/lightrag-poc/client.test.mjs
```

Remote endpoints require both HTTPS and `LIGHTRAG_POC_ALLOW_REMOTE=true`, an explicit risk acknowledgement; this should only be used with trusted instances and approved non-sensitive data.

## Scope and next step

Once the POC demonstrates benefits, implement an optional `GraphRetrievalProvider` adapter with the current permission and effective-time prefiltering **inside** the candidate retrieval pipeline, not merely by post-filtering a LightRAG-generated answer. The adapter must preserve `docId`/chunk references and version semantics and must be evaluated before enabling it for any real users. Until then, the current Neo4j pipeline remains the production implementation.
