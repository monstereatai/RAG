# RAG CLI 中文使用说明

`rag-cli` 是一个独立命令行工具，用来从 RAG 服务查询知识、发起问答、生成代码编写上下文包，并把结果以人类可读或机器可读的方式交给开发者、脚本、Agent 或 Skill 使用。

## 适用场景

- 开发者在终端里搜索知识库内容。
- Agent 在写代码前拉取 RAG 上下文。
- Skill 通过 JSON 输出读取结构化检索结果。
- CI 或自动化脚本检查 RAG 服务可用性。
- 团队统一使用同一套知识查询和代码上下文生成入口。

## 安装和构建

进入 CLI 项目目录：

```bash
cd rag-cli
```

安装依赖：

```bash
pnpm install
```

构建：

```bash
pnpm run build
```

查看命令：

```bash
node dist/src/bin.js --help
```

本地开发阶段可以直接用 `node dist/src/bin.js` 运行。发布或链接成全局命令之前，不要执行 `npm publish`。

## 基础配置

初始化配置：

```bash
node dist/src/bin.js init
```

默认配置文件位置：

```text
~/.config/rag-cli/config.json
```

配置文件只保存 CLI 需要的用户级配置，文件权限会尽量写成当前用户可读写。密码不会保存。

设置 RAG 服务地址：

```bash
node dist/src/bin.js config set baseUrl http://localhost:3000/api/v1
```

查看配置：

```bash
node dist/src/bin.js config get
```

查看单个配置：

```bash
node dist/src/bin.js config get baseUrl
```

设置 token：

```bash
node dist/src/bin.js config set token
```

也可以通过环境变量覆盖配置：

```bash
RAG_BASE_URL=http://localhost:3000/api/v1
RAG_TOKEN=your-token
```

优先级：

1. 命令行参数，例如 `--base-url`、`--token`
2. 环境变量，例如 `RAG_BASE_URL`、`RAG_TOKEN`
3. 本地配置文件
4. CLI 默认值

## 登录和认证

交互式登录：

```bash
node dist/src/bin.js auth login --username admin
```

指定服务地址登录：

```bash
node dist/src/bin.js auth login --base-url http://localhost:3000/api/v1 --username admin
```

脚本模式登录可以从 stdin 读取密码：

```bash
printf '%s' "$RAG_PASSWORD" | node dist/src/bin.js auth login --username admin --format json
```

查看登录状态：

```bash
node dist/src/bin.js auth status
```

退出登录，只清除本地保存的 token：

```bash
node dist/src/bin.js auth logout
```

注意：命令行参数里的 `--token` 可能进入 shell 历史。自动化场景优先使用 `RAG_TOKEN`。

## 常用命令

健康检查：

```bash
node dist/src/bin.js doctor
```

机器可读健康检查：

```bash
node dist/src/bin.js doctor --format json
```

搜索知识库：

```bash
node dist/src/bin.js search "如何实现检索增强生成"
```

限制返回数量：

```bash
node dist/src/bin.js search "Milvus 索引优化" --limit 5
```

问答：

```bash
node dist/src/bin.js ask "这个项目的 RAG 链路是怎么工作的"
```

指定回答模式：

```bash
node dist/src/bin.js ask "帮我解释检索链路" --mode strict
```

生成代码上下文包：

```bash
node dist/src/bin.js context "根据知识库内容实现 citation 校验"
```

给 Agent 或 Skill 使用时推荐 JSON：

```bash
node dist/src/bin.js context "根据知识库内容实现 citation 校验" --format json
```

查看 Skill：

```bash
node dist/src/bin.js skill list
```

匹配适合任务的 Skill：

```bash
node dist/src/bin.js skill match "我要写一个支持 RAG 查询的 CLI"
```

查看文档列表：

```bash
node dist/src/bin.js doc list
```

查看文档详情：

```bash
node dist/src/bin.js doc show <document-id>
```

## 输出格式

CLI 支持三种输出格式：

```bash
--format markdown
--format json
--format table
```

默认是 `markdown`，适合人在终端阅读。

`json` 适合脚本、CI、Agent、Skill 使用。JSON 模式下：

- stdout 只输出 JSON。
- 不输出颜色。
- 不输出 spinner。
- 不触发交互 prompt。
- 失败时包含稳定的 `error.code`、`error.message`、`error.recoverable`。

示例：

```bash
node dist/src/bin.js doctor --format json --base-url http://127.0.0.1:9/api/v1 --timeout 500
```

不可达服务时会返回类似结构：

```json
{
  "status": "error",
  "data": {
    "ok": false,
    "checks": []
  },
  "error": {
    "code": "doctor_failed",
    "message": "one or more checks failed",
    "recoverable": true
  }
}
```

## 给 Agent 或 Skill 使用

推荐使用 `context` 命令作为代码编写入口：

```bash
node dist/src/bin.js context "实现一个查询 RAG 内容并生成代码建议的命令" --format json
```

Agent 可以读取返回的结构化内容：

- `task`：本次任务描述。
- `knowledge`：RAG 返回的知识片段。
- `citations`：引用来源。
- `guidance`：建议执行步骤和验证命令。

代码生成流程建议：

1. 先调用 `rag context "<任务>" --format json` 获取上下文。
2. 从 `knowledge` 和 `citations` 提取依据。
3. 按 `guidance` 执行最小必要修改。
4. 执行返回的验证命令，例如 `pnpm run build`、`pnpm test`。
5. 把验证结果写回项目 `ROADMAP.md`。

## 企业级使用建议

- 团队统一配置 `RAG_BASE_URL`，避免每个人手写服务地址。
- 自动化场景统一使用 `--format json`。
- CI 中先跑 `rag doctor --format json`，失败时根据 `error.code` 分类处理。
- 不把 token 写入仓库、日志或 README 示例。
- 不让 CLI 直接访问数据库、向量库或缓存，只通过 RAG 后端 API。
- 不在 CLI 里写业务绕过逻辑，认证、权限和审计由后端负责。

## 常见问题

### 命令提示 unauthorized

说明当前没有有效 token，或 token 已过期。可以重新登录：

```bash
node dist/src/bin.js auth login --username admin
```

或者临时设置：

```bash
RAG_TOKEN=your-token node dist/src/bin.js doctor --format json
```

### 命令提示 service_unavailable

说明 RAG 服务不可达。检查：

- `--base-url` 是否正确。
- `RAG_BASE_URL` 是否正确。
- 后端服务是否启动。
- 本机网络或端口是否可访问。

### JSON 输出解析失败

先确认命令是否带了：

```bash
--format json
```

再确认没有把其他命令输出混进 stdout。当前 CLI 的 JSON 模式会禁用 spinner 和 prompt，正常情况下 stdout 应该只包含 JSON。

### 配置里的 token 为什么显示 `[saved]`

这是安全设计。`config get` 不会明文打印 token，避免 token 进入终端记录、日志或截图。

## 验证命令

修改 CLI 代码后至少执行：

```bash
pnpm run build
pnpm test
```

建议补充 smoke：

```bash
node dist/src/bin.js --help
node dist/src/bin.js doctor --format json --base-url http://127.0.0.1:9/api/v1 --timeout 500
```
