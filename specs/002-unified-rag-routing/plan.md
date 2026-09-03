# 实施计划：统一 RAG 路由与面试口径定稿

## 已确认上下文

- 相关模块：`KarpathyRagService`、`AgenticRagService`、`ChatService`、三种问答模式文档和活跃面试材料。
- 现有行为与约束：Simple 已有受治理直答和 Hybrid；Auto 已有 Fast Path 复用；Agentic 已有子问题、Web、Rerank、答案契约与 Reflection，但存在无索引／无证据模型兜底。
- 不确定项：无。旧参数和显式答案审批接口按兼容能力保留。

## 方案

- 数据流／状态流：精确直答门禁先行；未命中进入统一 Hybrid；Simple 强制经典 RAG，Auto 根据证据和复杂度路由，Agentic 执行复杂状态机。
- 接口或组件边界：增加公开的受治理直答入口；`answer` 保持兼容；Auto 调用直答入口后再决定是否执行 Fast Path。
- 兼容性与回退：不改变 API DTO；保留旧参数别名；不删除索引和类名；通过局部反向补丁可回退。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `docs/interview/功能步骤流程.md` | modify | 三种链路唯一流程真源 | AC-01、AC-05 |
| `docs/architecture/ARCHITECTURE.md` | modify | 统一架构与 Auto 规则 | AC-01、AC-05 |
| `README.md` | modify | 项目定位不再把 Karpathy 表述为独立 RAG | AC-05 |
| `docs/interview/README.md` | modify | 面试入口统一口径 | AC-05 |
| `docs/interview/interview-docs-usage.md` | modify | 清理旧 Fast Path 说法 | AC-05 |
| `docs/interview/AI复盘四场面试问题与RAG项目回答.md` | modify | 事实核对版同步 | AC-05 |
| `docs/interview/AI复盘四场面试问题与RAG项目回答-面试表达版.md` | modify | 表达版同步 | AC-05 |
| `docs/interview/INTERVIEW_PLAYBOOK.md` | modify | 删除超长强制 Simple 旧口径 | AC-05 |
| `backend/src/rag/karpathy/karpathy-rag.service.ts` | modify | 公开精确直答、统一 Hybrid、拒绝无证据模型兜底 | AC-01、AC-02、AC-06 |
| `backend/src/rag/karpathy/karpathy-rag.service.spec.ts` | modify | Simple 和直答回归测试 | AC-02、AC-06 |
| `backend/src/modules/chat/chat.service.ts` | modify | Simple 使用统一直答与 Hybrid 配置 | AC-01、AC-02 |
| `backend/src/rag/agentic/agentic-rag.service.ts` | modify | Auto 前置直答、路由修正、Agentic 安全收口 | AC-03、AC-04、AC-06 |
| `backend/src/rag/agentic/agentic-rag.service.spec.ts` | modify | Auto／Agentic 回归测试 | AC-03、AC-04、AC-06 |
| `ROADMAP.md` | modify | 验证通过后记录真实状态 | AC-05、AC-06 |

## 执行顺序

1. 定稿规范、架构与活跃面试材料。
2. 收紧 Direct Answer 和 Simple，更新定向测试。
3. 修改 Auto／Agentic 路由和无证据处理，更新定向测试。
4. 执行文档、Lint、测试、Build 和 Diff 验证，通过后更新 ROADMAP。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| Mermaid | Node＋Mermaid 11.15 解析《功能步骤流程》全部图 | 全部解析成功 |
| unit | `cd backend && npm test -- --runInBand src/rag/karpathy/karpathy-rag.service.spec.ts` | 全部通过 |
| unit | `cd backend && npm test -- --runInBand src/rag/agentic/agentic-rag.service.spec.ts` | 全部通过 |
| lint | `cd backend && npx eslint src/rag/karpathy/karpathy-rag.service.ts src/rag/karpathy/karpathy-rag.service.spec.ts src/rag/agentic/agentic-rag.service.ts src/rag/agentic/agentic-rag.service.spec.ts src/modules/chat/chat.service.ts` | 退出码为 0 |
| build | `cd backend && npm run build` | 退出码为 0 |

## 执行控制

- 状态恢复：on
- 独立审查：off
- 分支策略：当前 `main`；不创建或切换分支
- 提交策略：none

## 状态机注册

- 已注册 AC：AC-01 至 AC-06
- 已注册任务：T001 至 T004
- 状态文件：`specs/002-unified-rag-routing/state.json`

## 风险与回退

- 风险：目标代码和文档已有用户未提交修改；每个任务使用内容快照和文件白名单保护。
- 风险：拒绝模型兜底会改变空知识库体验；以明确拒答和联网补证替代，并用单测固定。
- 回退方式：只反向回退本 Spec 对应增量，不使用 `reset`、`restore` 或文件覆盖。

## 审批

- Plan 状态：approved
- 批准人：主人
- 批准时间：2026-08-31
