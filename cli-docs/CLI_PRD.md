# RAG CLI 功能列表 PRD

> 本文定义一个类似飞书 CLI 的 RAG CLI：让人、脚本、Codex/Claude Code、Skill 和其他研发工作流都可以直接用命令行查询 RAG 知识库，并把返回的上下文用于代码理解、生成、修改和验证。实施进度以 `CLI_ROADMAP.md` 为准。

## 1. 结论

第一版不要做“大而全的智能 IDE”，也不要做传统模板脚手架。最直接的路径是做一个稳定的命令行知识库网关：

1. `rag auth` 负责登录与 token 管理。
2. `rag search` 负责可引用的知识检索。
3. `rag ask` 负责基于知识库的问答。
4. `rag context` 负责输出结构化上下文包，给人类、脚本、Agent 或 Skill 直接消费。
5. `rag skill` 负责匹配和查看本地 Skill，属于可选增强，不是 CLI 的前置条件。
6. `rag eval` / `rag doctor` 负责验证知识库与服务状态。

CLI 的核心价值不是“替代 Agent 写代码”，而是把 RAG 知识库变成本地终端里的稳定能力：人可以直接查，脚本可以直接调，Agent 和 Skill 也可以在写代码前先拿到项目知识、引用片段、接口约束、历史决策和可验证命令。当前后端已形成 Karpathy + Obsidian Fast Path 与 Agentic RAG 互补链路，CLI 必须保留 `retrievalSufficient`、`retrievalReason`、`references`、`obsidianPaths` 等字段，不把纯模型兜底包装成可靠知识。

产品形态参考飞书官方 CLI：同一套命令既服务人类，也服务 AI Agent。技术实现参考成熟 Node CLI 生态：命令框架、交互输入、颜色输出、loading、配置文件和稳定 JSON 输出分层处理。

## 2. 背景

当前项目已经有文档上传、混合检索、Agentic RAG、引用校验、查询日志、RAG 管理 API、Skill 匹配接口和多租户隔离。缺口是：这些能力主要通过 Web/API 使用，不能被终端用户、本地脚本、编码 Agent 或 Skill 以统一命令直接调用。

目标是做一个面向研发工作流的 CLI，让它像飞书 CLI 一样成为统一入口：用户、脚本、Agent 和 Skill 不需要知道底层是 Milvus、BM25、Elasticsearch、GraphRAG 还是 Agentic RAG，只需要通过命令拿到可消费的上下文。

它和传统项目脚手架不同：传统脚手架的核心是下载模板、渲染文件、生成项目；本 CLI 的核心是查询知识库、问答、诊断服务和生成上下文包。后续可以增加 `rag init` 做本地配置初始化，但不把项目模板生成作为第一版目标。

## 3. 目标用户

| 角色 | 需求 |
|---|---|
| 主人/研发负责人 | 快速查询项目设计、历史决策、接口约束和验证方式 |
| Codex/Claude Code / 其他编码 Agent | 编码前查询项目 RAG，拿到结构化上下文再修改代码 |
| Skill 作者 | 可选地在 Skill 中调用 CLI，但不需要把 CLI 功能写死进 Skill |
| 前端/后端开发者 | 在终端里检索知识库、定位文档片段、生成上下文包 |
| 维护者 | 验证 RAG 服务、索引状态、检索质量和 Skill 匹配质量 |

## 4. 产品目标

- 让人类、脚本、Agent、Skill 都可以用稳定 CLI 查询 RAG 内容。
- 让编码 Agent 或研发脚本在改代码前获得“项目事实 + 引用 + 相关文件 + 验证命令”。
- 让检索结果可追溯：每条结果必须带 `docId`、`chunkId`、来源标题、分数和引用片段。
- 让输出适合机器消费：默认支持 `json`，同时提供人类可读表格/Markdown。
- 让人类输出足够舒服：支持交互式登录、彩色状态、loading，但这些体验不能污染 JSON 输出。
- 复用现有后端能力，不重复实现检索引擎。
- 不触碰生产发布、CI/CD、数据库 schema 变更等红线，除非后续单独确认。

## 5. 非目标

- 不做完整 IDE 插件。
- 不做传统模板脚手架，不下载远程模板，不渲染业务项目文件。
- 不做自动提交、自动部署、自动发版。
- 不让 CLI 直接读写向量库、数据库或 `.env`。
- 不绕过 JWT / service token / 多租户隔离。
- 不承诺 CLI 直接修改代码。代码修改由 Codex/Claude Code 等 Agent 执行，CLI 只提供上下文和建议。
- 不把所有外部知识源一次性接入。第一版只对接当前 RAG 后端。
- 不治理 Milvus runtime timeout、生产机器、证书、备份策略等运行环境事项；这些由后端和部署流程处理，CLI 只消费状态和接口结果。

## 6. 成功标准

- 人类、脚本、Agent 或 Skill 可以通过一条命令拿到 JSON 上下文包。
- 上下文包包含问题、相关知识片段、引用、风险提示、建议验证命令；如果启用 Skill 匹配，再附带匹配结果。
- 检索为空或低相关时，CLI 明确返回 `insufficient_context`，不伪造答案。
- 本地服务未启动、token 失效、权限不足时，错误信息可操作。
- CLI 命令可被脚本稳定调用，退出码明确。
- 不修改 `.env`，只读取用户显式传入的环境变量或配置文件。

## 7. 命令总览

| 命令 | 作用 | 第一版优先级 |
|---|---|---|
| `rag auth login` | 登录 RAG 服务并保存本地 token | P0 |
| `rag auth status` | 查看当前登录状态和服务地址 | P0 |
| `rag auth logout` | 清除本地 token | P1 |
| `rag search` | 检索知识库片段 | P0 |
| `rag ask` | 基于知识库提问 | P0 |
| `rag ask --stream` | 消费后端真实 SSE 流式问答 | P1 |
| `rag context` | 生成结构化上下文包 | P0 |
| `rag init` | 交互式初始化本地 CLI 配置 | P1 |
| `rag skill list` | 列出可用 Skill | P1 |
| `rag skill match` | 按任务描述匹配 Skill | P0 |
| `rag doc list` | 列出当前用户文档 | P1 |
| `rag doc show` | 查看文档元数据或 chunk | P1 |
| `rag admin search` | 查询运营侧热门/无结果/召回问题 | P2 |
| `rag graph query` | 查询 GraphRAG 关系型问题 | P2 |
| `rag eval run` | 触发已有 RAG 评测脚本或 API | P2 |
| `rag eval status` | 查看后端评测状态 | P2 |
| `rag doctor` | 检查服务、鉴权、索引和依赖状态 | P0 |
| `rag config get/set` | 管理 CLI 本地配置 | P1 |

## 8. P0 功能详述

### 8.1 `rag auth login`

用途：获取并保存 JWT，让后续命令不必重复传 token。

示例：

```bash
rag auth login --base-url http://localhost:3000/api --username admin
```

行为：

- 从 stdin 安全读取密码，不在命令历史中暴露。
- TTY 模式下可以用交互式 password prompt；非 TTY/CI 模式必须通过安全输入或 token 环境变量完成。
- 调用 `POST /api/auth/login`。
- token 默认保存到用户级 CLI 配置目录，不写入项目仓库。
- 支持 `RAG_BASE_URL` / `RAG_TOKEN` 环境变量覆盖。

验收：

- 登录成功后 `rag auth status` 显示已登录用户和 base URL。
- 密码不写入日志、配置文件或 shell history。
- token 失效时提示重新登录。
- `--format json` 模式不输出 spinner、颜色控制符或交互提示。

### 8.2 `rag search`

用途：检索知识库片段，给人或 Agent 查看原始依据。

示例：

```bash
rag search "Agentic RAG 主链路是什么" --limit 5 --format json
```

输出字段：

```json
{
  "query": "Agentic RAG 主链路是什么",
  "status": "ok",
  "results": [
    {
      "docId": "doc_xxx",
      "chunkId": "chunk_xxx",
      "title": "ROADMAP.md",
      "content": "...",
      "score": 0.87,
      "source": {
        "documentName": "ROADMAP.md",
        "section": "当前核心优化标准"
      }
    }
  ]
}
```

行为：

- 优先调用正式 `POST /api/v1/rag/search`；连接旧后端且接口不存在时，才保守降级到 `debug/chunks`。
- 默认只返回当前用户有权限的内容。
- 支持 `--format json|markdown|table`。
- 支持 `--mode simple|auto`，默认 `simple`。

验收：

- 结果包含来源和分数。
- 无结果返回 `status=insufficient_context`。
- 低分结果不被包装成确定答案。

### 8.3 `rag ask`

用途：向 RAG 提问，适合人类在终端快速问答。

示例：

```bash
rag ask "这个项目改完代码后要跑哪些验证？" --mode auto
```

行为：

- 调用现有 chat API。
- 默认非流式输出最终答案。
- `--stream` 时直接消费后端真实 SSE，不做客户端延迟拆字模拟。
- 答案必须保留引用信息。

验收：

- simple/auto/agentic 三种模式可选。
- 低相关、引用失败、知识不足时输出明确拒答。
- Markdown 模式输出答案、检索状态、来源和 Obsidian 路径；`--format json` 输出完整 `answer/references/retrievalSufficient/retrievalReason/obsidianPaths/route/threadId`。

### 8.4 `rag context`

用途：生成代码编写或研发排障前的上下文包。这是第一版最核心命令，可被人类直接阅读，也可被脚本、Agent 或 Skill 以 JSON 消费。

示例：

```bash
rag context "为 RAG 项目新增 CLI，先写 PRD" \
  --include-roadmap \
  --format json
```

输出字段：

```json
{
  "task": "为 RAG 项目新增 CLI，先写 PRD",
  "status": "ok",
  "matchedSkills": [
    {
      "name": "coding",
      "score": 8.3,
      "reason": "任务涉及代码实现与项目规范"
    }
  ],
  "knowledge": [
    {
      "title": "CLAUDE.md",
      "chunkId": "chunk_xxx",
      "content": "改完主动跑验证...",
      "score": 0.91
    }
  ],
  "codingGuidance": {
    "assumptions": ["CLI 只作为 RAG API 客户端，不直接访问数据库"],
    "constraints": ["不得修改 .env", "不得变更 CI/CD", "不得绕过 JWT"],
    "likelyFiles": ["CLI_PRD.md", "CLI_ROADMAP.md"],
    "validationCommands": ["npm run build", "npm run lint"]
  },
  "riskFlags": ["涉及新依赖时需要先确认"],
  "citations": [
    {
      "id": 1,
      "docId": "doc_xxx",
      "chunkId": "chunk_xxx",
      "title": "CLAUDE.md"
    }
  ]
}
```

行为：

- 优先调用正式 `POST /api/v1/rag/context`；连接旧后端且接口不可用时，才在 CLI 内组合 `skill match` + `search` + 规则提取。
- `search/debug chunks` 为空时可调用 `ask auto` 作为 Karpathy + Obsidian 兜底；纯模型兜底答案不能算可靠上下文。
- `skill match` 是可选增强；未启用 Skill 时仍可只基于 RAG 检索生成上下文包。
- 只返回事实和约束，不直接改代码。
- 支持 `--max-tokens` 控制输出体积。
- 支持 `--paths` 让调用方声明当前将修改的文件范围。
- 支持 `--match-skill` 显式开启 Skill 匹配。
- 支持 `--require-citations`，默认开启。

验收：

- 能被人类直接阅读，也能被 Codex/Claude Code、脚本或 Skill 以 JSON 稳定解析。
- 每条建议必须能追溯到知识库片段或明确标注为推断。
- 没有足够上下文时返回 `insufficient_context`，并建议补充文档或扩大查询。

### 8.5 `rag skill match`

用途：根据任务描述匹配本地 Skill。

示例：

```bash
rag skill match "修复 RAG 检索引用不足问题" --limit 3 --format json
```

行为：

- 调用现有 `GET /api/skills/match`。
- 返回 name、description、tags、score、matchMode。
- 不自动执行 Skill。

验收：

- `skills/` 为空时返回空列表和可操作提示。
- embedding 不可用时自动回退 token 匹配。

### 8.6 `rag doctor`

用途：检查 CLI 能否正常连接 RAG 服务。

示例：

```bash
rag doctor
```

检查项：

- base URL 是否配置。
- token 是否存在且有效。
- `/api/health` 是否可访问。
- `/api/skills` 是否可访问。
- 检索 API 是否可访问。
- 当前用户是否有文档。
- RAG 后端是否返回明确能力清单。

验收：

- 全部通过返回 exit code `0`。
- 可恢复问题返回 exit code `1`，并给出修复建议。
- 配置错误、鉴权错误、服务不可达要区分显示。

### 8.7 `rag init`

用途：像脚手架一样完成“初始化配置”，但不生成业务项目代码。

示例：

```bash
rag init
```

行为：

- 交互式询问 `baseUrl`。
- 询问是否立即登录。
- 检查 RAG 服务健康状态。
- 写入用户级 CLI 配置文件。
- 不写项目 `.env`。
- 不下载模板、不创建业务项目、不修改 RAG 服务文件。

验收：

- 新机器上运行 `rag init` 后，可以继续执行 `rag doctor`。
- CI/非交互模式下不阻塞等待输入。
- 不保存密码。

## 9. 交互体验规范

CLI 同时服务人和机器，必须分清 human output 与 machine output。

### 9.1 人类模式

默认终端模式：

- 可以使用颜色、状态符号、spinner。
- 长任务显示 loading。
- 错误提示要给下一步命令。
- 表格只用于短列表。

### 9.2 机器模式

触发条件：

- `--format json`
- `--quiet`
- `CI=true`
- stdout 不是 TTY

规则：

- stdout 只输出 JSON 或明确要求的纯文本。
- spinner、颜色、debug 日志都走 stderr 或完全关闭。
- 不出现交互式 prompt。
- 失败时使用稳定错误码和退出码。

### 9.3 交互式命令边界

允许交互：

- `rag init`
- `rag auth login`
- `rag config set`

不允许默认交互：

- `rag search`
- `rag ask --format json`
- `rag context --format json`
- `rag doctor --format json`

## 10. 脚手架能力边界

本 CLI 可以借鉴脚手架的用户体验，但不承担项目模板生成职责。

吸收：

- 命令分组。
- 交互式配置。
- 统一日志与状态输出。
- 版本检查。
- 本地配置读写。

不吸收：

- 下载远程模板。
- 渲染项目文件。
- 插件包市场。
- 自动创建业务项目目录。
- 自动覆盖已有文件。

## 11. P1 功能

### 11.1 `rag config`

管理本地 CLI 配置。

```bash
rag config get baseUrl
rag config set baseUrl http://localhost:3000/api
```

约束：

- 不写项目 `.env`。
- 不保存密码。
- token 存储路径必须在用户目录下。

### 11.2 `rag doc list/show`

查看当前用户文档和片段。

```bash
rag doc list
rag doc show doc_xxx --chunks --limit 10
```

用途：

- 编码前确认知识库里是否已有项目文档。
- 调试检索结果为什么缺上下文。

### 11.3 `rag context --watch`

监听输入任务文件或 prompt 文件变化，重新生成上下文包。

```bash
rag context --from task.md --watch --output .rag/context.json
```

约束：

- 只写调用方显式指定的输出文件。
- 不自动改源码。

## 12. P2 功能

### 12.1 `rag admin search`

查询运营分析数据。

```bash
rag admin search popular
rag admin search no-result
rag admin search recall-issues
```

用途：

- 发现知识库高频问题。
- 发现无结果问题和召回失败问题。
- 为后续补文档、补评测集提供依据。

### 12.2 `rag graph query`

面向关系型问题调用 GraphRAG。

```bash
rag graph query "哪些系统依赖 RAG 服务？"
```

约束：

- GraphRAG 未启用时明确返回 disabled。
- 不把图谱查询结果伪装成普通检索结果。

### 12.3 `rag eval run`

触发已有 RAG 评测能力。

```bash
rag eval run --suite quality
rag eval run --suite project --require-live
```

约束：

- 第一版可以只是封装后端已有脚本说明，不强行接 CI。
- 不修改 CI/CD 配置。

## 13. 输出格式规范

所有命令必须支持：

- `--format json`：给 Agent 和脚本使用，字段稳定。
- `--format markdown`：给人阅读。
- `--quiet`：只输出关键结果。
- `--verbose`：输出请求阶段、耗时和诊断信息，但不得输出 token。

错误格式：

```json
{
  "status": "error",
  "code": "unauthorized",
  "message": "token expired, please run rag auth login",
  "recoverable": true
}
```

建议退出码：

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 可恢复错误，如服务未启动、token 失效、无检索结果 |
| `2` | 参数错误 |
| `3` | 鉴权/权限错误 |
| `4` | 服务端错误 |

## 14. 配置与安全

配置来源优先级：

1. 命令行参数。
2. 环境变量：`RAG_BASE_URL`、`RAG_TOKEN`。
3. 用户级配置文件。
4. 默认值：`http://localhost:3000/api`。

安全约束：

- token 不写入仓库。
- 密码只从 stdin 读取。
- 日志不输出 token、密码、密钥。
- CLI 只调用后端 API，不直接访问数据库、向量库、Redis 或 `.env`。
- service token 只用于明确的内部运营命令，普通用户命令走 JWT。

## 15. 直接使用与可选 Skill 集成

CLI 可以直接使用，不需要写在 Skill 里。Skill 只是其中一种调用方。

人类直接使用：

```bash
rag search "RAG 主链路质量闸门" --format markdown
rag ask "这个项目改完代码后要跑哪些验证？"
```

Agent / 脚本调用推荐协议：

```bash
rag context "$TASK" --format json --max-tokens 8000
```

消费规则：

- 先读 `status`，非 `ok` 时停止编码或降级为只读分析。
- 优先使用 `codingGuidance.constraints`。
- 使用 `knowledge` 作为项目事实，不把模型猜测当事实。
- 引用 `citations` 解释为什么要改某些文件。
- 按 `validationCommands` 执行验证。

## 16. 典型工作流

### 16.1 人类查询

```bash
rag ask "当前 RAG 主链路有哪些质量闸门？"
```

### 16.2 编码前取上下文

```bash
rag context "修复上传 PDF 后引用缺失的问题" \
  --paths backend/src/modules/document,backend/src/rag \
  --format json
```

### 16.3 Agent 生成修改计划

Agent 根据 `rag context` 的结果输出：

- 已知项目约束。
- 可能涉及文件。
- 修改方案。
- 验证命令。
- 风险和红线。

### 16.4 修改后验证

```bash
rag doctor
cd backend && npm run build
cd backend && npm run lint
```

## 17. API 依赖

第一版尽量复用现有接口：

| CLI 能力 | 后端接口 |
|---|---|
| 登录 | `POST /api/auth/login` |
| 当前用户 | `GET /api/auth/profile` |
| 文档列表 | `GET /api/documents` |
| 问答 | `POST /api/chat` |
| 流式问答 | `GET /api/chat/stream` |
| Debug 检索 | `GET /api/debug/chunks` |
| Skill 列表 | `GET /api/skills` |
| Skill 匹配 | `GET /api/skills/match` |
| 健康检查 | `GET /api/health` |
| 运营能力 | `GET /api/rag/admin/capabilities` |

可能需要新增的薄封装接口：

| 接口 | 原因 |
|---|---|
| `POST /api/rag/context` | 后端统一聚合 Skill 匹配、检索、约束提取，减少 CLI 拼装复杂度 |
| `POST /api/rag/search` | 提供正式检索 API，避免长期依赖 debug 接口 |

新增接口如果涉及 DTO 和权限，不涉及数据库 schema 变更时可作为普通代码改动；如果需要 schema 变更，必须先单独确认。

## 18. 分阶段计划

### Phase 1：CLI MVP

- `rag auth login/status`
- `rag init`
- `rag search`
- `rag ask`
- `rag skill match`
- `rag context`
- `rag doctor`

验收：

- 本地后端启动后，人类、脚本、Agent 或 Skill 都能通过 `rag context --format json` 获取上下文包。
- token 失效、服务未启动、无检索结果都有明确错误。
- 不修改 `.env`、CI/CD、数据库 schema。

### Phase 2：研发体验增强

- `rag config`
- `rag doc list/show`
- `rag context --watch`
- Markdown/table 输出优化。
- 补齐正式 `POST /api/rag/search` 或 `POST /api/rag/context`。

验收：

- 人类终端使用足够顺滑。
- Agent、Skill 和脚本消费 JSON 足够稳定。
- 不再依赖 debug 接口完成核心检索。

### Phase 3：运营与质量闭环

- `rag admin search`
- `rag graph query`
- `rag eval run`
- 与 query log / eval / GraphRAG 形成闭环。

验收：

- 能发现高频问题、无结果问题、召回失败问题。
- 能把问题转化为补文档、补评测、补规则的行动项。

## 19. 待确认问题

- CLI 包名：建议先用 `rag`；如果和系统命令冲突，再改为 `ragx` 或 `rag-cli`。
- token 存储方式：建议优先用户级配置文件；是否接入 macOS Keychain 待确认。
- 是否允许 CLI 上传文档：第一版不做，避免把 CLI 范围扩大到完整文档管理。
- 是否需要 npm 包发布：第一版不发布，仓库内本地运行即可；公开发布属于红线，必须单独确认。
- 是否新增 `POST /api/rag/context`：建议 Phase 2 做，MVP 可先由 CLI 聚合现有接口。
