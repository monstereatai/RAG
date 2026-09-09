# 验证记录

## 已完成验证

- `pnpm --dir backend build`：通过。
- `pnpm --dir admin tsc --noEmit`：通过。
- `pnpm --dir admin-backend build`：通过。
- RAG 评测：新增 `context_recall` 指标、关键证据缺失断言和 Query Augment 0.8 相似度门禁；切分策略 overlap 已统一至 10%～20% 字符预算。
- 动态语义切分实验：句子／段落边界装箱已启用，按文档类型保留不同 overlap；PRD 样例 overlap 15.38%、语义边界率 100%。

## 待补验证

- 真实浏览器 E2E：当前开发服务的 Nest watch 进程因既有 `dist` 目录清理冲突无法重启，需要清理构建产物后执行。
- 接口契约快照：下一轮对 admin 文档、QA 会话和 Agent Ops 工作流响应逐条采样，确认不再出现嵌套信封。
- Jest 用例：仓库当前 Jest 30 运行时缺少 `clearMocksOnScope`，测试套件尚未启动；需先统一 Jest／ts-jest 版本后重跑。
