# 任务清单：Coding Task 队列分发类型修复

## T001：显式区分普通 revise 与 coding_task

- 允许文件：`apps/rag-api/src/modules/workflow/production-workflow.control.ts`
- 验证：`cd apps/rag-api && npm run build`；`cd apps/rag-api && npm test -- --runInBand src/modules/workflow/workflow-dispatch-contract.spec.ts`
- 完成定义：构建与 dispatch contract 测试通过；coding_task 在错误 processor 中不会被当成 revise 执行。
