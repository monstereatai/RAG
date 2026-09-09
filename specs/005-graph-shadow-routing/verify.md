# 验证记录

## 已完成

- `pnpm --dir backend exec tsc --noEmit`：通过。
- `git diff --check`：通过。
- `GraphService.queryGraph(..., { generateAnswer: false })`：旁路探测跳过图谱答案生成。
- Karpathy 检索：图谱旁路最多 6 条事实、1.2 秒超时；关系／多跳／依赖／影响关键词命中时才合并上下文。

## 阻塞与边界

- `pnpm --dir backend build`：被既有 `backend/dist` 清理冲突 `ENOTEMPTY` 阻断，未执行删除操作。
- 定向 Jest：被既有 Jest 30 runtime `clearMocksOnScope` 兼容错误阻断，测试未启动。
