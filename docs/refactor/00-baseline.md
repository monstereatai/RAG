# 重构前基线

日期：2026-10-29（Asia/Shanghai）。原分支 main，HEAD `fb7d5dd9b8150667e563ea7017afb6a17c975d9b`。经主人“批准执行所有计划”授权创建 `refactor/rag-agent-architecture`。

启动前已有修改：`.obsidian/community-plugins.json`、`.obsidian/workspace.json`、`ROADMAP.md`、`docs/interview/功能步骤流程.md`、`workspace/bm25-index.json`，及两个 Obsidian 插件目录。保留原内容，ROADMAP 仅增量记录本次工作。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm build` | PASS，六个 workspace 应用/工具构建通过 |
| `pnpm --dir backend exec jest --runInBand` | FAIL，107 suites：94 pass、13 fail；556 tests：513 pass、43 fail |
| 全仓 lint | FAIL，backend 1011 errors/30 warnings，admin 6 errors/21 warnings，admin-backend 0 errors/2 warnings，frontend PASS |
| P1a 九个既有文件定向 ESLint | FAIL，90 errors/0 warnings；原始快照 `specs/046-rag-agent-architecture/eslint-baseline.json` |

这些命令在改码前审计阶段执行。全仓 build/Jest/lint 的原始终端结果见本会话，未保存成独立机器报告；不能伪造旧日志。后续新验证写入 evidence 文件。已有失败涉及 RAG 参数、DomainEvents 测试替身、Admin 图片权限及 ConversationEmbedding；不默认归因于本次重构。

任务书的 2026-09 HEAD/行数已过期。`SERVICE_BOUNDARIES.md` 有“后续新增 admin-backend”等旧措辞，而目录和 HTTP client 已存在。Spec 003 的 tasks 已 done，但其旧 state 无法被当前状态工具读取且缺 verify；Spec 043 仍 executing，Chat 统一入口代码已存在。本次不重写其历史状态。
