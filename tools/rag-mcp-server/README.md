# RAG MCP Server

`rag-mcp-server` 是给 Codex、Trae、Claude Code、Cursor 等 AI 编程工具使用的 MCP stdio 服务。它把项目里的 RAG/Karpathy/Obsidian/GraphRAG 能力暴露成工具，让 Agent 编码前先自动查内部知识、组件用法、活动/官网营销方案和上线 checklist。

## CLI 和 MCP 的分工

- CLI：给人、脚本、CI、批量导入、批量评测使用。
- MCP：给 Agent / AI 编程工具使用，让 Codex/DeepSeek/Claude Code 在写代码前自动取上下文。

两者都只通过 RAG 后端 API 工作，不直接访问数据库、向量库或 `.env`。

## 配置

配置优先级：

1. `RAG_MCP_BASE_URL` / `RAG_MCP_API_KEY`
2. `RAG_MCP_TOKEN`
3. `RAG_MCP_USERNAME` / `RAG_MCP_PASSWORD` 自动登录
4. `RAG_BASE_URL` / `RAG_API_KEY` / `RAG_TOKEN`
5. `~/.config/rag-cli/config.json`
6. 默认 `http://localhost:3000/api/v1`

推荐先用 CLI 登录一次，让 MCP 复用 `rag-cli` 的本地用户配置：

```bash
cd /Users/monster/Documents/GitHub/code/RAG/rag-cli
pnpm run build
node dist/src/bin.js auth login
```

## 客户端配置示例

把下面的命令配置到支持 MCP 的 AI 编程工具里：

```json
{
  "mcpServers": {
    "rag": {
      "command": "node",
      "args": [
        "/Users/monster/Documents/GitHub/code/RAG/tools/rag-mcp-server/dist/src/server.js"
      ],
      "env": {
        "RAG_BASE_URL": "http://localhost:3000/api/v1"
      }
    }
  }
}
```

如果不使用 `rag-cli` 配置，可以显式传 token：

```json
{
  "env": {
    "RAG_MCP_BASE_URL": "http://localhost:3000/api/v1",
    "RAG_MCP_TOKEN": "your-local-token"
  }
}
```

不要把 token 提交到代码仓库。

生产化或长期使用推荐使用 Admin 生成的长期 API Key：

```json
{
  "env": {
    "RAG_MCP_BASE_URL": "http://localhost:3000/api/v1",
    "RAG_MCP_API_KEY": "rag_pat_xxx"
  }
}
```

API Key 不使用登录 JWT 的 7 天有效期；后端只保存 hash，明文只在创建时返回一次，可在 Admin 中吊销。

如果不想处理 token 过期，推荐让 MCP 自动登录。MCP 会在没有 token 或后端返回 401 时重新登录：

```json
{
  "env": {
    "RAG_MCP_BASE_URL": "http://localhost:3000/api/v1",
    "RAG_MCP_USERNAME": "admin",
    "RAG_MCP_PASSWORD": "admin123"
  }
}
```

## 工具清单

| 工具 | 用途 |
|------|------|
| `rag_health` | 检查 RAG 后端健康状态 |
| `rag_search` | 检索知识片段和已审核纠错证据并返回充分性判断，适合检查证据、内部组件和规范，不负责生成答案 |
| `rag_context` | 生成可喂给 AI Coding 的上下文包 |
| `rag_ask` | 直接走完整 RAG 问答链路，包含质量门禁、已审核 Bad Case 纠错和可用的 Obsidian 证据 |
| `rag_graph_query` | 查询 GraphRAG 实体关系 |
| `rag_agent_domains` | 查询 Supervisor 支持的领域 |
| `rag_agent_pipeline` | 调用 Supervisor 多 Agent 管线，返回 researcher/analyst/writer/critic/editor 阶段 |
| `rag_production_workflow_context` | 按活动名称查找最近一条已完成产研运工作流，并返回审批后代码交接物，供 Codex 在当前代码目录实施 |
| `rag_production_workflow_activities` | 查询当前用户可见的产研运活动、状态、完成岗位和更新时间 |
| `rag_game_plan` | 生成游戏活动/官网营销方案上下文 |
| `rag_game_checklist` | 生成上线前 checklist |
| `rag_game_tracking` | 生成埋点方案草案 |
| `rag_game_region_check` | 生成多地区/本地化检查清单 |

## 典型用法

MCP 不是给普通用户点页面用的入口，它主要在 AI 编程工具需要外部上下文、项目知识或后端能力时调用：

```text
人直接用系统：Admin / Web / CLI
Agent 自动用系统：MCP
```

### 产研运工作流完成后交给 Codex 编码

1. 在 Admin 的「Agent 运营→产研运工作流」启动工作流，等待状态变为「已完成」；如果处于「待审批」，先在详情页完成审批。
2. 有浏览器目录选择能力时，进入工作流详情：点击「导出 Markdown 交接物」只生成 `RAG_WORKFLOW_CONTEXT.json`、`README.md` 和 `handoff/{岗位}/*.md`；点击「生成可运行项目代码」会把已审批 Markdown 交给后端 LLM 生成结构化文件，并直接下载 ZIP，解压后可在目录中执行 `npm install && npm run dev`。
3. 使用 MCP 时，在 Codex 中配置本 MCP Server，先调用 `rag_production_workflow_activities` 查看活动列表，再调用 `rag_production_workflow_context`，参数传入活动名称，例如 `act10`，不需要手动复制 Thread ID。MCP 会自动匹配最近一条已完成工作流。
4. Codex 读取返回的产品、设计、前端、后端、测试和运营交接物，在当前代码目录中实现；写代码前仍应先检查本地代码和测试，不把 Markdown 交接物直接当成已验证代码。

MCP 工具只读取已完成的工作流，不直接写入本机目录。目录写入由浏览器在用户明确选择目录后完成，避免服务端获得任意文件系统写权限。

| 触发场景 | 推荐工具 |
|----------|----------|
| 写代码前需要查内部组件、业务规则、项目规范 | `rag_search` / `rag_context` |
| Codex 要根据知识库生成开发计划 | `rag_context` |
| 需要先理解某个活动/营销/官网业务需求 | `rag_game_plan` |
| 要生成上线检查清单 | `rag_game_checklist` |
| 要生成埋点方案 | `rag_game_tracking` |
| 要检查台湾服/东南亚服/海外差异 | `rag_game_region_check` |
| 要查活动、页面、接口、埋点之间的关系 | `rag_graph_query` |
| 要直接问事实或业务问题，并获得与 QA Ops 一致的答案 | `rag_ask` |
| 要跑复杂方案生成、多 Agent 分析 | `rag_agent_pipeline` |
| 要确认 RAG 后端是否正常 | `rag_health` |

更贴近开发流程的调用顺序：

```text
1. 接到需求
   -> rag_context / rag_game_plan

2. 准备写代码
   -> rag_search

3. 方案不清楚
   -> rag_agent_pipeline

4. 涉及图谱关系
   -> rag_graph_query

5. 准备上线
   -> rag_game_checklist / rag_game_region_check

6. 编码过程中遇到不确定问题
   -> rag_ask
```

写代码前让 Agent 调：

```text
先用 rag_context 查“官网活动落地页的内部组件和埋点规范”，再根据返回上下文改代码。
```

做游戏活动方案时让 Agent 调：

```text
调用 rag_game_plan，activity=周年庆抽奖活动，platform=H5，小程序，region=TW/SEA。
```

查图谱关系时让 Agent 调：

```text
调用 rag_graph_query，query=抽奖活动涉及哪些页面模块、接口和埋点。
```

跑多 Agent 方案管线时让 Agent 调：

```text
调用 rag_agent_pipeline，task=东南亚服新角色抽奖 H5 活动怎么做技术方案。
```

后端会先路由到领域，再按领域执行 `researcher / analyst / writer / critic / editor` 的子集，并返回每个阶段的耗时和置信度。

边界：MCP 不是替代 RAG 后端，也不是替代 Admin 后台。它只是 Agent 调用项目能力的协议入口。

### 页面答得出，但 `rag_search` 搜不到

这是两类工具的职责差异：`rag_search` 返回召回片段和匹配的已审核纠错证据，便于检查检索证据；`rag_ask` 会继续执行答案生成、检索质量门禁、已审核 Bad Case 纠错和其他补充证据链。直接提问“某人是谁”“某项制度是什么”时仍应使用 `rag_ask` 获取最终答案，但 `rag_search` 也应能返回匹配的审核证据。

当 `rag_search` 返回了候选片段但相关性不足时，结果会保留片段用于排障，同时返回：

```json
{
  "status": "insufficient_context",
  "retrievalSufficient": false,
  "retrievalReason": "候选片段未通过检索质量门禁"
}
```

## 本地验证

```bash
cd /Users/monster/Documents/GitHub/code/RAG/tools/rag-mcp-server
pnpm install --ignore-scripts
pnpm run build
pnpm test
node dist/src/server.js --help
```
