# 执行窗口 4：Sandbox、安全、产品化与 JD

本任务单供主人在第 4 个 Codex 窗口执行。它拆分自[当前缺口清单](./ai-agent-rag-missing-and-optimization-checklist.md)，不替代原清单；以原清单和当前源码为准。

## 负责范围

- 项目级 P0 OpenSandbox 安全验收与 P1 目标岗位系统集成。
- 技术栈模块：T17、T36–T43。
- 第 4 节 J01–J14 全部岗位差距；第 5 节沙箱边界与目标岗位触发的优化项。
- Admin Ops、Coding Agent 工作区和前端交互中有证据的本地问题。

## 独占源码范围

- `apps/admin-web/src/pages/agent-ops/`
- `apps/admin-api/src/modules/`（不含窗口 3 的 `qa-ops/`、`rag-client/`）
- `apps/rag-api/src/common/guards/`
- `apps/rag-api/src/modules/auth/`
- `apps/rag-api/src/modules/platform-governance/`
- `apps/rag-api/src/modules/workflow/production-project-workspace*.ts`
- `apps/rag-api/src/modules/agent-ops-admin/`

不要修改窗口 1 的 Agent/工具模块、窗口 2 的 RAG/数据索引模块、窗口 3 的 Trace/Jobs/Eval 模块。

## 当前已知实现，避免重复造轮子

- 平台治理写入端点已有运行时 DTO 校验；API Token `expiresAt` 要求严格 ISO 日期字符串。
- RagGateway 的 reviewed Bad Case 查询已按当前用户/租户收窄，避免跨用户/租户证据泄漏（该源码归窗口 3，禁止修改）。
- Admin Ops 工作区会恢复并锁定已绑定的代码 artifact；切换前提示导出并销毁。
- Workspace export 已有路径穿越/符号链接边界保护的本地覆盖；这不等于真实 Sandbox 命令隔离验收。
- 真实 OpenSandbox、目标机器资源/网络限制、登录态 E2E、目标行业数据和外部 ERP/DC/Mem0 均尚需目标环境或目标 JD。

## 执行规则

1. 先检查 `git status --short` 和目标文件现有 diff；四个窗口共享工作树，保留其他窗口改动。
2. 不要为覆盖 JDs 一次性加入营销、汽车、零售、酒店、物流、支付等行业子系统。没有主人选定的 JD 和业务契约，只报告适用差距。
3. 不运行单测，不修改 `.env`、密钥、CI/CD，也不做生产部署；只实现当前仓库内有证据的小功能。
4. 并行期间避免共享 `dist/` 全量构建。完成后报告改动、静态验证、需要真实 Sandbox/用户研究/目标系统的剩余项；ROADMAP 与总清单由主窗口统一合并。

## 目标岗位验收边界

个人年限/学历/语言要求、真实产品成功率、用户采纳率、行业知识、ERP/DC/MCP 接口与生产上云能力不能由源码声称完成。先选具体 JD，再把该 JD 的外部条件转为单独任务。
