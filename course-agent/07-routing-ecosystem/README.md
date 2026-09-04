# 第 7 节讲义 · 路由与生态：Supervisor、Skills 与 MCP

> 课程：《从零手撕企业级 AI Agent》第 7 节 · 路由生态
> 源码：[supervisor.service.ts](../../backend/src/modules/supervisor/supervisor.service.ts) · [skills.service.ts](../../backend/src/modules/skills/skills.service.ts) · [mcp.provider.ts](../../backend/src/providers/mcp/mcp.provider.ts) · [mcp.controller.ts](../../backend/src/modules/mcp/mcp.controller.ts) · [smoke-mcp.mjs](../../backend/scripts/smoke-mcp.mjs)
> 先修：第 2 节（MCP 工具也要过 Tool Registry）

## 一、痛点引出

一个 Agent 打天下是不现实的：客服问题和技术排障需要完全不同的工具集与管线；"怎么写周报"这类**做事方法**知识塞进 System Prompt 会撑爆上下文；外部能力（搜索、内部系统）不可能都自己写。三个问题对应三个机制：**Supervisor 领域路由、Skills 技能匹配、MCP 外部工具**——本节的关键不是"接入"，而是**接入的每一层都要过治理**。

## 二、整体架构：请求进来的三次分流

```
用户请求 → Supervisor（领域路由：这个话题归哪个管线？）
  → 选定 Agent 管线（agent-pipeline.service）
      → Skills（这个岗位干活需要哪份"操作手册"？语义匹配注入）
      → 工具调用（全部过第 2/3 节治理壳；MCP 拉来的也不例外）
```

## 三、代码拆解

### 3.1 Supervisor：领域路由（supervisor.service.ts）

`DomainConfig` 定义领域：`name` / `description`（中文描述）/ `keywords`（关键词列表，用于快速分类）/ 使用的 Agent 管线。分类路径：关键词快速命中 → 不确定时交给 LLM 按描述分类。**教学引导语**：注意"关键词先行、LLM 兜底"的两级设计——关键词命中是零成本的确定性匹配，LLM 分类是兜底的语义理解，**便宜的先走**。这与 RAG 课程第 5 节"直答捷径先于全量检索"是同一个成本意识：路由是分层的（RAG 第 6 节 shouldUseAgentic 管模式级，这里管领域级），每层都是"先便宜后昂贵"。

### 3.2 Skills：操作手册的语义检索（skills.service.ts）

技能是文件（元数据 + 内容），加载走 `fs/promises` 读本地目录；匹配用 `OpenAIEmbeddings` 语义相似度——用户任务与技能描述算向量距离，命中才注入。**Skills = "怎么干某类活"的知识库**，与 RAG（"事实知识"库）解耦：把周报格式塞 System Prompt 会污染所有对话；作为技能按需注入，用不到就零成本。对照 Claude 的 Agent Skills 生态——同一思想：能力文档化、按需激活。

### 3.3 MCP：外部工具生态（mcp.provider.ts L31-100）

```ts
// McpProvider：MultiServerMCPClient 从 YAML 配置加载 servers
// → getTools() 拉取并缓存各 server 的工具
```

YAML 声明式配置 MCP servers（stdio 本地进程或远程），启动时拉取工具清单缓存；[mcp.controller.ts](../../backend/src/modules/mcp/mcp.controller.ts) 的 `GET /mcp/tools` 暴露给前端/下游；[smoke-mcp.mjs](../../backend/scripts/smoke-mcp.mjs)（`npm run smoke:mcp`）连 server、拉工具列表、调用 `rag_smoke_status` 验证连通——**生态接入要有连通性冒烟**，不能等用户请求挂了才发现 server 早没了。

### 3.4 关键防线：MCP 工具也要"入籍"（tool-registry.ts 的 mcp_tools 条目）

Tool Registry 里有一条 `source: 'mcp'` 的注册条目：MCP 拉来的工具同样要过四道闸（mode/角色/插件白名单）。**教学引导语**：这是本节的灵魂。MCP 生态的叙事是"即插即用"，但企业现实是：外部 server 返回的工具 schema 你没审过、超时行为你没控过、降级语义你没定义过。**外部能力接入的正确姿势：先入籍（注册元数据），再上岗（过治理壳）**——生态开放 ≠ 权限裸奔。对照第 2 节 fallback 字段：mcp_tools 条目的 fallback 写明"MCP server 未启用或失败时禁用对应工具，不影响核心 RAG"——外部依赖的故障半径被预先声明。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：MCP 工具绕过 Registry 直通模型

- **现象**：图省事把 `getTools()` 的结果直接绑给模型，上线后被安全审计打回——外部 server 的一个 `delete_file` 工具对模型完全可见。
- **根因**：MCP 的便利性与治理壳的默认拒绝天然冲突——直通 = 绕过四道闸 + 无审批 + 无幂等。
- **排查三步**：审计模型可见的工具列表来源 → 确认每个工具在 Tool Registry 有注册条目 → 按 `source: 'mcp'` 补齐元数据（risk/timeout/fallback）。预防：**工具绑定的唯一入口是 Registry**，代码 review 盯住所有 `getTools()` 的消费点。

### 坑点 2：Skills 语义匹配的噪声

- **现象**：技能注入后回答跑偏——匹配到的"周报技能"其实相似度只有 0.4，把不相关的格式要求带进了上下文。
- **根因**：语义匹配没有阈值门槛，top-1 就注入；技能描述写得含糊，向量空间里区分度低。
- **排查/预防**：给匹配加分数阈值与 top-k 限制；技能描述写清**适用条件与不适用条件**（描述质量决定向量区分度）；观察注入命中率指标，长期低命中的技能回炉重写。

## 五、讲师口播稿（约 300 字）

> 前六节课我们把单个 Agent 和它的流水线做扎实了，今天把视野放大：一个系统里不会只有一个 Agent。三个问题等着你。第一，用户的请求该交给谁？客服问题和技术排障需要的工具集完全不同——Supervisor 做领域路由，注意它的两级设计：关键词先走，零成本；分不准再让 LLM 兜底。贵的永远放后面。第二，"怎么干某类活"的知识放哪？塞 System Prompt 会污染所有对话，写成技能文件、语义匹配按需注入——用不到就是零成本。第三，外部能力怎么接？MCP 确实即插即用，但我问你：外部 server 返回的工具 schema 你审过吗？超时行为你控过吗？所以这一节最重要的一句话是：MCP 拉来的工具也要入籍——先注册元数据，再过四道闸，才许上岗。生态开放和权限裸奔之间，隔着一层 Tool Registry。记住它，你的 Agent 系统才敢真的开放。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 7 节](../README.md)）：自定义 MCP server 接入 + supervisor 路由 + 技能匹配
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
