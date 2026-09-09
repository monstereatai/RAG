# 验证记录：LLM 失败保护与多问题路由修复

## 范围与 Diff

- 计划内文件：Provider、语义路由、Agentic／Chat 编排、定向测试与 ROADMAP。
- 无关改动：`.obsidian/workspace.json` 为预先存在的本地状态，未纳入本次范围。
- `git diff --check`：通过。

## 自动验证

| 验证 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| Provider 失败边界 | 编译产物注入失败的 `invoke` | pass | Qwen／DeepSeek 均抛出 `LlmInvocationError`，`leakedPrompt=false` |
| 多问题路由 | 编译产物 `QueryIntentRouter` | pass | `multiIntent=true`，返回 2 个子问题 |
| 多问题门禁 | 编译产物 `AgenticRagService` | pass | `isMultiIntentQuery` 返回 `true` |
| TypeScript | `pnpm --dir backend exec tsc --noEmit` | blocked | 受既有 Spec 类型错误阻断，生产构建不受影响 |
| Backend build | `pnpm --dir backend run build` | pass | 退出码 0 |
| 定向 Jest | 4 个相关 Spec | blocked | 仓库既有 Jest 29／30 `clearMocksOnScope` 运行时兼容错误，0 个测试开始执行 |
| AG-UI SSE | `React 是什么？1+1 等于多少？`，Auto／DeepSeek | pass | `multi_intent_query`、2 条子问题、最终回答覆盖 React 与 `1+1=2`，无 Mock／Prompt |

## 验收标准追踪

| AC | 结果 | 验证证据 | 备注 |
| --- | --- | --- | --- |
| AC-01 | pass | Provider 故障注入 | 无 Mock 文本或 Prompt 泄露 |
| AC-02 | pass | AG-UI SSE 与 Agentic 门禁编译产物验证 | 两条子问题保留并进入独立检索 |
| AC-03 | pass | `QueryIntentRouter` 保守回退实现与 TypeScript 检查 | 路由异常统一 general |

## 例外与风险

- 3000 端口的现有后端由多组遗留热重载进程竞争 `dist`；未终止用户进程，因此未覆盖正在运行实例。
- 定向 Jest 需先解决 workspace 内 Jest 29／30 环境版本冲突后复验。

## 结论

- 状态：ready_for_review
- 人工验收：待主人在页面验证。
