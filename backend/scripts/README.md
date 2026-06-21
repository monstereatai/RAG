# Smoke scripts

These scripts turn the remaining roadmap follow-ups into repeatable checks.
They print JSON summaries only and must not print API keys, bearer tokens, raw
audio, vectors, or full model responses.

Run from `backend/`.

- `npm run smoke:mcp`: loads `workspace/mcp-servers.yaml`, calls the local MCP smoke server tool.
- `npm run mcp:validate`: validates `workspace/mcp-servers.yaml` shape without starting any MCP server. Use `MCP_CONFIG_PATH=...` to check a business config.
- `npm run smoke:graph`: logs in, imports `eval/graph-smoke.seed.json`, checks schema and GraphRAG query.
- `npm run graph:import-business -- --dry-run`: validates `eval/graph-business.seed.example.json` or `GRAPH_BUSINESS_SEED=...` without calling the backend. Remove `-- --dry-run` to import into a running GraphRAG backend.
- `npm run smoke:speech`: calls backend TTS SSE, then sends the generated wav to backend ASR.
- `npm run smoke:speech:direct`: calls Tencent TTS and ASR directly without a running backend.
- `npm run smoke:external`: real Bocha, DashScope Rerank, and Qwen judge calls when keys exist; otherwise reports skipped checks.
- `npm run smoke:external:required`: same checks as `smoke:external`, but missing keys fail the run. Use this after Bocha/Rerank/Qwen keys are filled.
- `npm run smoke:redis-checkpointer`: verifies checkpoint storage can be read by a separate Node process.
- `npm run smoke:hybrid`: uploads fixed Chinese regression documents, checks debug retrieval, then deletes the uploaded docs.
- `npm run eval:rag:judge`: optional Qwen LLM-as-Judge check for claim support. It skips when `QWEN_API_KEY` is not set.
- `npm run eval:rag:quality`: stable local gate. It always runs offline RAG eval and the 120-case business dataset check. Set `EVAL_RAG_JUDGE_REQUIRED=true` to make Qwen LLM-as-Judge mandatory.
- `npm run eval:business-dataset`: checks the generated 120-case business regression dataset shape and coverage.
- `npm run eval:business-import -- --input eval/business-regression.import.example.json`: validates a real business regression dataset import file. Add `-- --input <path> --write --min-cases 100` only after the private dataset is sanitized and ready to overwrite `eval/business-regression.dataset.json`.

Backend service checks default to `http://localhost:3001`.
