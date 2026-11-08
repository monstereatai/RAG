# Coding Task 队列分发类型修复

## 目标

让新增的 `coding_task` 队列消息不能落入以 `dto` 为输入的普通 Workflow 分支，确保 RAG API 可编译且任务处理器职责明确。

## 验收标准

- AC-01：`production-workflow.control.ts` 显式处理 `start`、`resume`、`revise`；`coding_task` 误入普通处理器时明确报错，不读取不存在的 `dto`。
- AC-02：RAG API build 与 workflow dispatch contract 定向测试通过。

## 范围

- 修改：`apps/rag-api/src/modules/workflow/production-workflow.control.ts`
- 不接入真实 OpenSandbox；按主人要求继续暂缓。
