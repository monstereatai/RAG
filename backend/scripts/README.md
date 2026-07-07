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
- `npm run smoke:milvus`: checks Milvus collection/schema/index metadata, loadCollection, load state, loading progress, SDK/server versions, and a bounded warmup search. Use this when first vector retrieval emits timeout warnings. A failing search with healthy/indexed/loaded metadata points to Milvus runtime/version/segment state rather than RAG answer logic.
- `npm run smoke:vision-video`: validates the private multimodal dataset has image/audio/video files and audio/video transcript sidecars. Set `VISION_VIDEO_REQUIRE_PROVIDER=true` only when a real OCR/video provider key must be mandatory.
- `npm run smoke:redis-checkpointer`: verifies checkpoint storage can be read by a separate Node process.
- `npm run smoke:hybrid`: uploads fixed Chinese regression documents, checks debug retrieval, then deletes the uploaded docs.
- `npm run eval:rag:judge`: optional Qwen LLM-as-Judge check for claim support. It skips when `QWEN_API_KEY` is not set.
- `npm run eval:rag:langsmith`: runs the stable local RAG evaluation and writes a LangSmith-friendly JSON export to `.tmp/langsmith-rag-eval.json`. Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, and `LANGSMITH_PROJECT` to let LangChain/DeepAgents calls emit LangSmith traces during the run. Set `LANGSMITH_UPLOAD=true` to upload Dataset/Experiment data through LangSmith REST API; add `LANGSMITH_UPLOAD_REQUIRED=true` only when upload failure should fail CI.
- `npm run eval:rag:maturity`: local enterprise maturity score. It checks the four core standards, business eval coverage, smoke entrypoints, governance evidence, and explicit external blockers. Default threshold is `RAG_MATURITY_MIN_SCORE=90`; set `RAG_PRODUCTION_MATERIALS_CONFIRMED=true` only after production target/cert/backup inputs are confirmed, and set `RAG_MATURITY_REQUIRE_EXTERNAL=true` only when private business data and production materials must block the gate.
- `npm run eval:rag:project`: project-like business evaluation. It validates `eval/project-simulated-business.dataset.json`; when the backend is running, it uploads simulated business documents and scores live simple/auto answers. Set `PROJECT_EVAL_REQUIRE_LIVE=true` to fail instead of skipping when the backend is unavailable.
- `npm run eval:rag:quality`: stable local gate. It always runs offline RAG eval, the 120-case business dataset check, and the local maturity gate. Set `EVAL_RAG_JUDGE_REQUIRED=true` to make Qwen LLM-as-Judge mandatory.
- `npm run eval:business-dataset`: checks the generated 120-case business regression dataset shape and coverage.
- `npm run eval:business-import -- --input eval/business-regression.import.example.json`: validates a real business regression dataset import file. Add `-- --input <path> --write --min-cases 100` only after the private dataset is sanitized and ready to overwrite `eval/business-regression.dataset.json`.
- `npm run fixtures:private:prepare`: generates the sanitized private fixture pack: 50 business poison questions, multimodal files, GraphRAG seed docs, and organization permission data.
- `npm run fixtures:private:check`: validates the generated private fixture pack exists and has the expected coverage.
- `npm run eval:business-private`: validates `eval/private-business-regression.dataset.json` with at least 50 cases.
- `npm run eval:rag:multimodal:private`: validates `eval/private-multimodal.dataset.json` in strict asset mode.
- `npm run graph:import-private`: dry-runs `eval/private-graph-business.seed.json`.

Backend service checks default to `http://localhost:3000`.
