# 实施计划：Coding Task 队列分发类型修复

## 修改

- 将普通 Workflow processor 的最终 `else` 改为显式 `revise` 分支，并为不应进入此 processor 的 `coding_task` 添加明确错误处理。
- 保持队列服务既有的 `coding_task` 专属 processor 路由。

## 文件与验证

- `apps/rag-api/src/modules/workflow/production-workflow.control.ts`
- `cd apps/rag-api && npm run build`
- `cd apps/rag-api && npm test -- --runInBand src/modules/workflow/workflow-dispatch-contract.spec.ts`

主人已批准将该最小兼容修复纳入本次工作，证据为回复“批准，补最小修复并继续”。
