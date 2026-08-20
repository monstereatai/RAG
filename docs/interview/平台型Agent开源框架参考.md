# 平台型 Agent 开源框架参考

> 用途：学习 DeepSeek Harness 一类平台型 Agent 的运行时、任务编排、工具治理、记忆、Sandbox、Checkpoint、评测和可观测设计。
>
> 原则：只吸收适合当前项目的设计，不整体替换现有 LangGraph、Simple／Auto／Agentic、RAG、MCP、Redis Checkpointer 和 Agent Ops。

## 一、优先学习的项目

| 项目 | 重点学习内容 | 对当前项目的参考价值 |
|---|---|---|
| [OpenHands](https://github.com/OpenHands/OpenHands) | Agent 控制中心、多后端 Agent、Docker／VM 执行、自动化任务、事件流、工程任务编排 | 参考 Agent 运营平台、任务中心、代码 Sandbox、自动化触发和产物交付 |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) | Issue → 代码修改 → 测试 → Patch、Agent-Computer Interface、轨迹和 Benchmark | 参考需求到代码到测试闭环，以及 Agent 轨迹评测 |
| [Letta](https://github.com/letta-ai/letta) | 有状态 Agent、长期记忆、Memory Filesystem、记忆版本化、Sub-agent | 参考长期记忆、记忆文件、记忆压缩、记忆审计和跨任务复用 |
| [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) | Graph Workflow、类型安全路由、Checkpoint、人工介入、Middleware、Telemetry、MCP | 参考企业级 Agent Runtime、工作流恢复、审批门禁和统一中间件 |
| [Pydantic AI](https://github.com/pydantic/pydantic-ai) | 类型安全 Agent、结构化输出、依赖注入、工具组合、Evals、可观测 | 参考 Agent 输入输出 Schema、工具参数校验、结构化 Artifact 和评测接口 |

## 二、其他值得学习的项目

### 1. smolagents

[Hugging Face smolagents](https://github.com/huggingface/smolagents)

重点看：

- `CodeAgent` 和 `ToolCallingAgent` 的差异；
- 代码式工具调用；
- 工具绑定；
- Sandbox 执行；
- 极简 Agent Runtime。

适合参考：

```text
Agent
  → 选择工具
  → 生成代码或结构化调用
  → Sandbox 执行
  → 返回结果
```

它更适合学习 Agent 执行机制，不适合直接作为当前项目的后台平台。

### 2. Dify

[Dify 官方仓库](https://github.com/langgenius/dify)

重点看：

- 应用、模型、工具、知识库控制面；
- Workflow 节点配置；
- Prompt 和模型版本管理；
- API 化；
- 运行日志；
- 知识库调试；
- 插件和工具治理。

当前项目可继续吸收：

```text
模型配置
  → Prompt 版本
  → 工具版本
  → 知识库版本
  → 应用／链路版本
  → 运行记录
  → 回归评测
```

### 3. RAGFlow

[RAGFlow 官方仓库](https://github.com/infiniflow/ragflow)

重点看：

- 文档解析和复杂文档理解；
- 父子切块；
- 表格、图片和版面处理；
- 检索调试；
- 知识库管理；
- Agent 与 RAG 融合。

对当前项目最有价值的是补强文档解析质量、父子块召回、表格和图片引用、检索链路调试及召回评测。

### 4. AutoGen

[AutoGen 官方仓库](https://github.com/microsoft/autogen)

重点看：

- Agent 消息传递；
- Agent as Tool；
- 多 Agent 对话；
- 事件驱动运行；
- MCP；
- 工具预算和终止条件。

当前项目保留 LangGraph 做状态机更合适，不需要替换执行引擎。

### 5. CrewAI

[CrewAI 官方仓库](https://github.com/crewAIInc/crewAI)

重点看：

- Agent、Task、Crew 三层抽象；
- Sequential／Hierarchical 协作；
- 角色、目标和背景；
- Task 依赖；
- 任务输出结构化。

当前项目的产品、设计、前端、后端、测试、运营岗位模型，可以参考它的 Task 和 Role 设计，但继续使用当前项目自己的活动营销角色和交付物。

### 6. MetaGPT

[MetaGPT 官方仓库](https://github.com/FoundationAgents/MetaGPT)

重点看：

- 软件公司角色协作；
- PRD、设计、代码、测试等结构化产物；
- SOP；
- 角色间消息；
- Artifact 依赖。

它对当前产研运工作流最有参考价值，但不直接复制它的角色体系。

### 7. Continue

[Continue 官方仓库](https://github.com/continuedev/continue)

重点看：

- 仓库内声明式 Agent；
- Markdown 配置 Agent；
- CI 中自动执行审查 Agent；
- 代码审查结果回写；
- Agent 能力随仓库版本管理。

适合参考：

```text
项目规范／Skill／Prompt
  → Git 管理
  → Agent 执行
  → 代码审查
  → CI 验证
  → 结果反馈
```

## 三、按学习目标选择

### 想学习 Agent 平台整体架构

```text
OpenHands
  → Microsoft Agent Framework
  → DeepSeek Harness
  → Dify
```

重点学习 Agent 控制台、Run／Thread、事件流、工具注册、Sandbox、Checkpoint、审批、产物和运营监控。

### 想学习多 Agent 协作

```text
MetaGPT
  → CrewAI
  → AutoGen
  → Microsoft Agent Framework
```

重点学习 Agent 角色、Task 依赖、消息传递、DAG、并行和串行、冲突处理及人工介入。

### 想学习 Agent 记忆

```text
Letta
  → DeepSeek Harness
  → Microsoft Agent Framework
```

重点学习长期记忆、短期上下文、记忆文件、记忆压缩、记忆版本、跨 Thread 恢复和记忆审计。

### 想学习 AI Coding Agent

```text
OpenHands
  → SWE-agent
  → Continue
  → DeepSeek Harness
```

重点学习 Issue 到 Patch、代码 Sandbox、测试验证、Git Diff、代码审查、失败轨迹和 Agent 任务恢复。

### 想学习 RAG＋Agent 平台

```text
RAGFlow
  → Dify
  → LangGraph
  → Microsoft Agent Framework
```

重点学习文档解析、Chunk、Hybrid Search、Rerank、Agent 调用知识库、知识库版本、检索调试、评测和观测。

## 四、对当前项目最值得吸收的设计

当前项目已经具备 LangGraph、Simple／Auto／Agentic、RAG、MCP、Redis Checkpointer、Artifact、Agent Ops 和插件系统，不建议整体迁移框架。

当前项目已新增 Agent Runtime 控制层：运行计划、Skill 匹配、上下文策略和失败起点分析通过统一服务进入问答 Run 和运行中心；Admin Backend 提供 Runtime capabilities／plans 代理入口；实际执行仍由 LangGraph、Agent Pipeline、Tool Registry 和 Redis Checkpointer 完成。

最值得继续吸收的是五项：

1. OpenHands：Agent 控制中心和多后端执行。
2. Letta：文件型长期记忆和记忆版本化。
3. SWE-agent：代码任务轨迹评测。
4. Microsoft Agent Framework：Middleware、Checkpoint 和人工介入模型。
5. Pydantic AI：类型安全工具和结构化输出设计。

最终目标：

```text
AI 问答
  → Simple／Auto／Agentic 路由
  → RAG／Tool／MCP
  → Agent Runtime
  → Redis Checkpoint
  → Agent Run／Trace
  → Artifact／代码／测试结果
  → 人工审批
  → 评测回归
  → LangFuse／Prometheus
```

## 五、学习结论

最推荐的学习顺序是：

1. OpenHands：先理解平台控制面和代码 Agent 运行面；
2. Letta：理解有状态 Agent 和长期记忆；
3. SWE-agent：理解真实代码任务、测试和轨迹评测；
4. Microsoft Agent Framework：理解企业级 Workflow、Checkpoint、Middleware 和人工介入；
5. Pydantic AI：理解类型安全、结构化输出和生产级评测。

不要把这些框架简单堆到当前项目中。正确做法是继续使用当前项目的 LangGraph 作为执行引擎，再按需吸收平台控制、记忆、Sandbox、评测、工具治理和可观测设计。
