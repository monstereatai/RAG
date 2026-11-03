# Code RAG：多语言源码解析与知识库入库补丁

目标仓库：`monstereatai/RAG`，`apps/rag-api` NestJS 后端（以 2026-11-03 `main` 为基线）。

## 当前实现

- 单文件支持 JS/JSX/TS/TSX、Vue SFC、Java、Go、Python、C/C++、C#、Rust、PHP、Ruby、Kotlin、Swift、Dart、Scala、Bash、CSS/SCSS 等。SQL/GraphQL/proto 仅提供 **文本级** 解析并标记告警，不假装有 AST 语义。
- 使用 Tree-sitter 驱动的 `@ast-grep/napi` 抽取类、函数、方法、导入以及相关符号；Vue 通过官方 `@vue/compiler-sfc` 分离脚本、模板和样式。
- ZIP 仓库快照批量解析：过滤依赖、构建文件、密钥文件及不安全路径，限制压缩体积/源文件数/解压大小；只解析文本，不执行上传代码。
- 按符号分块，大函数按行拆分，保留文件路径、语言、符号、行号、父子块等元数据；继续复用原有 PostgreSQL、Milvus、BM25/ES 的索引流程。
- 扩充 `documentType='code'`，避免代码进入一般文档知识图谱和通用 LLM 摘要；源码不再经 Obsidian 二次保存；修复同步上传的意外 `return`。

## 一键应用（在 Mac 或开发环境）

先将这个 ZIP 解压到任意位置，确保本地已拉取最新的 `monstereatai/RAG`：

```bash
python3 apply_code_rag.py /path/to/RAG --check
python3 apply_code_rag.py /path/to/RAG
cd /path/to/RAG
corepack enable
pnpm install --no-frozen-lockfile
pnpm --filter backend build
pnpm --filter backend test -- --runInBand code-parser.util.spec.ts code-chunker.util.spec.ts
pnpm --filter backend test -- --runInBand hybrid-document-chunker.spec.ts document-parser.util.spec.ts
```

`--check` 做无写入预检，正式安装先备份被改动文件到仓库外的 `RAG-code-rag-backup-20261103` 目录。补丁对原始文件使用唯一锚点，遇到不同版本主动中止，避免修改错位置。**先确认本地没有未提交修改，检查 `git diff` 再提交。**

> **依赖锁文件说明**：补丁会为 `apps/rag-api/package.json` 增加 `@ast-grep/napi` 与 `@vue/compiler-sfc`。由于当前 GitHub 连接不允许创建分支，且此运行环境无法访问 npm，无法在此生成新版 `pnpm-lock.yaml` 或实际运行完整依赖测试；上面的 `pnpm install --no-frozen-lockfile` 会在你本地更新锁文件，提交前应把 `pnpm-lock.yaml` 一起提交。

## API 行为

保留原来的 `POST /api/v1/documents/upload` / `upload/async` 文件上传接口（multipart 字段 `file`），现在也识别 `.js`、`.tsx`、`.vue`、`.java`、`.go`、`.py`、`.zip` 等。生产建议使用 `/upload/async`，配合现有 BullMQ 和对象存储。ZIP 是**源码快照**而非 Git 同步，不包含定时拉取/分支同步/提交比较能力。

## 本次未实现、不能误认为已经完成

- Git 远程仓库授权抓取、Webhook 自动同步、基于 Git 提交的精准增量/删除对账（现有文档 `incrementalUpdate` 能力不等于仓库级增量同步）。
- 跨文件精确引用、LSP/SCIP 索引和完整调用图。当前仅把 import 语句和符号写入 chunk provenance，不做语义解析绑定。
- 对全部语言/Grammar 的生产验收与性能压测。Vue 2 特殊语法、超大源码仓库和缓存性能需真实样例验证。
- 检索侧按 `filePath` 等元数据做精确过滤、渲染带行号可点击引用；chunk metadata 已持久化，检索 UI 还需单独接入。

## 重点自测

1. 同步上传 `sample.ts` 后任务正常完成而非提前返回；异步上传同样可用。
2. 上传有 `class + 2 methods` 的 Java / TS 源码，检索结果分别有方法级 chunk，原始路径、符号和行号可追溯。
3. `.vue` 的 template、script、style 不会揉成同一块。
4. ZIP 内的 `node_modules`、`.env`、构建产物不进入索引；不安全路径应跳过/拒绝。
5. 检索新增源码后，不影响 PDF、Excel、Markdown 的现有业务回归测试。
6. 在不同 worker 实例、Redis 重启环境下验证新的源码异步上传任务与已有恢复链路。
