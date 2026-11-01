# RAG Golden 100 候选题库（非正式验收证据）

- `apps/rag-api/eval/private-reviewed-golden.candidate.json`：100 条 RAG + Agent 候选，尚无真实 Doc ID、Chunk ID、来源或审批。
- `apps/rag-api/eval/private-reviewed-golden.evidence.candidate.json`：逐题标注真实证据的空模板。
- `apps/rag-api/eval/private-agent-run-map.candidate.json`：30 条 Agent Run ID 空模板。
- `apps/rag-api/scripts/finalize-private-golden-dataset.mjs`：人工补齐证据后校验并生成正式 Dataset 的 CLI。
- `docs/GOLDEN_100_REAL_DATA_GUIDE.md`：完整操作流程与注意事项。
- `docs/GOLDEN_100_CANDIDATES_REVIEW.md`：100 条问题审阅清单。

**解压至 RAG 仓库根目录**。在项目 `apps/rag-api` 里查看 `docs/` 指引，先把来源文件和审核记录放进被 Git 忽略的 `.tmp/private-golden/`。生成器严格拒绝缺失来源和审核的候选数据，不会自动制造 `synthetic:false` 的假证据。
