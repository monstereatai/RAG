# 任务清单：统一 Chat 编排与三模式收敛

## T001：固定 Simple 边界与请求语义

- 依赖：无
- 允许文件：`backend/src/modules/chat/chat.service.ts`、`backend/src/modules/chat/chat.service.spec.ts`、`backend/src/rag/agentic/agentic-rag.service.spec.ts`
- 操作：确保显式 Simple 不调用 Agentic；保持一次分类、来源策略和 Fast Path 复用契约。
- 对应 AC：AC-01、AC-02、AC-03
- 验证：`pnpm --dir backend exec jest src/modules/chat/chat.service.spec.ts src/rag/agentic/agentic-rag.service.spec.ts --runInBand --testEnvironment /Users/monster/.codex/worktrees/cd20/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node`
- 完成定义：模式与证据边界有回归断言并通过。

## T002：抽取统一 Chat 执行与结果收口

- 依赖：T001
- 允许文件：`backend/src/modules/chat/chat.service.ts`、`backend/src/modules/chat/chat.service.spec.ts`
- 操作：抽取可复用的执行入口、最终正文事件门禁与幂等结果持久化。
- 对应 AC：AC-02、AC-04、AC-05
- 验证：同 T001 命令。
- 完成定义：HTTP 继续使用同一执行入口，正文和落库采用同一最终结果。

## T003：收敛 SSE 与 AG-UI 适配层

- 依赖：T002
- 允许文件：`backend/src/modules/chat/chat.controller.ts`、`backend/src/modules/agui/agui.service.ts`、`backend/src/modules/agui/agui.service.spec.ts`
- 操作：删除入口层的重复 Agentic 调用与重复持久化，保留 SSE／AG-UI 格式、模型选择、角色、插件和 Artifact 能力。
- 对应 AC：AC-02、AC-04、AC-05
- 验证：`pnpm --dir backend exec jest src/modules/chat/chat.service.spec.ts src/modules/agui/agui.service.spec.ts --runInBand --testEnvironment /Users/monster/.codex/worktrees/cd20/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node`
- 完成定义：三入口经过公共编排，运行事件可实时发送，正文只在最终答案确定后发送。

## T004：回归验证与文档同步

- 依赖：T003
- 允许文件：`backend/src/rag/agentic/agentic-rag.service.spec.ts`、`docs/interview/功能步骤流程.md`、`ROADMAP.md`
- 操作：补证据复用回归，更新流程图与已验证状态。
- 对应 AC：AC-01～AC-05
- 验证：计划中的全部 unit、Mermaid、`git diff --check` 与后端 build。
- 完成定义：验证记录可追溯，文档不夸大未实现的恢复或权限治理能力。
