# 实施计划：统一 Chat 编排与三模式收敛

## 已确认上下文

- `ChatService` 已拥有 HTTP 主链的分类、来源策略、运行审计和记忆保存能力。
- SSE 控制器、AG-UI 服务各自直接调用 `AgenticRagService.run` 并分别持久化，造成平行编排。
- `prefetchedFastPath`、`EvidenceBundle`、`requiresGraph` 已存在，应复用，不新增第二套证据对象。
- 现有工作区有用户变更；本次只修改下表文件及本目录工件。

## 方案

- 在 `ChatService` 增加可被非 HTTP 入口调用的统一执行方法：准备一次 Request Context，固定模式边界，收集运行事件，缓冲 token，完成最终校验后再发布正文，并统一保存和审计。
- `chat()` 继续作为普通 HTTP 适配层；SSE 和 AG-UI 只负责请求参数、模型包装、事件协议与 Artifact 展示，改为调用该统一方法。
- 显式 Simple 一律直接调用 Karpathy 线性回答；公共直答／澄清由公共编排处理，不再通过 Agentic 入口绕回 Simple。
- 沿用 Fast Path、EvidenceBundle、Obsidian 格式化与按需图谱机制；补齐跨入口测试和流程文档。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `backend/src/modules/chat/chat.service.ts` | modify | 提供统一执行、事件发布与结果收口 | AC-01～05 |
| `backend/src/modules/chat/chat.service.spec.ts` | modify | 覆盖 Simple 边界与一次分类 | AC-01～03 |
| `backend/src/modules/chat/chat.controller.ts` | modify | SSE 变为公共编排适配层 | AC-02、04、05 |
| `backend/src/modules/agui/agui.service.ts` | modify | AG-UI 变为公共编排适配层 | AC-02、04、05 |
| `backend/src/modules/agui/agui.service.spec.ts` | modify | 覆盖事件顺序与统一保存 | AC-04、05 |
| `backend/src/rag/agentic/agentic-rag.service.spec.ts` | modify | 回归证据复用／Simple 上限 | AC-01、03 |
| `docs/interview/功能步骤流程.md` | modify | 图与口径同步最终实现 | AC-01～05 |
| `ROADMAP.md` | modify | 记录已验证状态 | AC-01～05 |

## 执行顺序

1. 固定 Simple 执行上限与公共结果类型，补主链回归。
2. 提取 ChatService 统一执行／事件缓冲／保存收口；HTTP 继续兼容。
3. SSE、AG-UI 改为适配公共入口，保留模型、角色、插件、Artifact 与协议事件。
4. 补跨入口定向回归，更新流程图和路线图，执行静态与构建验证。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| unit | backend 定向 Jest：Chat、AG-UI、Karpathy、Agentic、QueryIntent | 所有目标用例通过 |
| static | `git diff --check` | 无空白错误 |
| docs | Mermaid 解析 29 个流程图 | 全部可解析 |
| build | `pnpm --dir backend run build` | 无新增本次相关错误；既有 `playwayPreview` 错误单独记录 |

## 执行控制

- 状态恢复：on
- 独立审查：off
- 分支策略：保持当前 detached HEAD，不创建或切换分支
- 提交策略：none

## 风险与回退

- 风险：流式正文延迟增加；AG-UI 事件顺序与 Artifact 展示回归；现有脏工作区干扰范围识别。
- 回退方式：仅回退本次变更文件的本次 hunks；不操作用户已有修改或 Git 历史。

## 审批

- Plan 状态：approved
- 批准人：主人
- 批准时间：2026-09-12
- 审批证据：用户附件给出最终方案，随后明确请求「按照这个来优化掉。全部优化完」。
