# 实施计划

## 文件范围

- `backend/src/modules/graph/graph.service.ts`：增加仅检索事实、不生成答案的查询选项。
- `backend/src/rag/karpathy/karpathy-rag.service.ts`：并行启动图谱旁路探测、超时保护、按意图合并图谱 Chunk，并记录诊断。
- `backend/src/rag/karpathy/context-builder.ts`：扩展图谱证据意图识别所需的关系词规则（如缺失）。
- `backend/src/rag/karpathy/karpathy-rag.service.spec.ts`：补充旁路探测成功、普通问题不合并和失败降级验证。
- `ROADMAP.md`、`specs/005-graph-shadow-routing/verify.md`：记录交付和验证证据。

## 数据流

1. 主链路开始时并行启动关键词、向量和图谱 shadow probe。
2. 图谱 probe 使用 1.2 秒超时、最多 6 条事实；仅返回实体关系事实，不调用图谱答案生成。
3. 关系／多跳／依赖／影响分析问题将事实转换为 `RetrievedChunk`，与 RRF／Rerank 后候选一起进入 ContextBuilder。
4. 其他问题丢弃图谱事实，仅把 enabled、attempted、elapsed、factCount、skippedReason 写入诊断。

## 验证与提交

- `pnpm --dir backend build`
- 相关 Karpathy／GraphService 定向测试（若受仓库既有 Jest 运行时阻断则记录原因）
- `git diff --check`
- 提交策略：`phase`，提交信息使用中文 `feat:` 前缀。

## 验证例外

- Backend `nest build` 当前被既有 `dist` 目录清理冲突（`ENOTEMPTY`）阻断，本次未删除构建产物；使用 `tsc --noEmit` 完成类型验证。
- Jest 当前被仓库既有 Jest 30 runtime 缺少 `clearMocksOnScope` 阻断，未能启动测试用例。
