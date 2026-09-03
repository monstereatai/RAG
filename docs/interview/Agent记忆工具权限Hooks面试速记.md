# Agent 记忆、工具、权限与 Hooks 面试速记

> 目标：按当前项目真实实现回答“Agent 怎么记忆、怎么调用工具、怎么控权限、怎么自动触发”。只记主链路，不堆概念。

## 一句话总览

用户请求进入后，系统先装配可用记忆，再由链路决定是否调用工具；工具执行前经过 Registry（工具注册表）、模式／岗位权限、插件白名单和审批门禁；节点、工具和状态变化通过事件 Hooks 记录，重要领域事件进入 Outbox（事件待投递箱），再自动触发通知或后续处理。

## 1．记忆：短期上下文＋长期事实＋可恢复状态

### 用户操作

用户连续追问同一个会话，系统自动带上最近上下文；对话过长时不需要用户手动整理，系统自动压缩；用户也可以在个人中心查看或清理长期记忆。

### 项目里的数据／状态流程

```text
进入问答
→ 按 Thread 读取 PostgreSQL 会话历史
→ Redis 读取最近消息窗口和历史摘要
→ Mem0 并行读取 user 记忆（跨会话事实）和 session 记忆（当前任务）
→ 会话向量库按语义补充少量相关旧问答
→ 合并角色、短期、长期和相关历史上下文
→ 超过 Token 预算时压缩旧消息，只保留最近窗口＋结构化摘要
→ 把上下文交给 Simple／Auto／Chat Agentic
→ 回答后写回 PostgreSQL、Redis，并由分类器判断是否写入 Mem0
```

### 面试怎么说

“我把记忆分三层：Redis 保存短期热窗口和摘要，PostgreSQL 保存会话事实和摘要持久副本，Mem0 保存经过分类的用户长期事实和当前会话任务。长上下文达到 Token 阈值后，只压缩旧消息，保留最近窗口；Checkpoint 只负责 Agent 执行恢复，不和聊天记忆混用。”

代码入口：`backend/src/modules/memory/`、`backend/src/providers/mem0/`、`backend/src/providers/langgraph-checkpointer/redis-checkpointer.ts`。

## 2．工具：模型不能直接执行，必须经过统一执行外壳

### 用户操作

用户选择 Auto／Agentic 或在产研运工作流中启用插件。系统根据链路和岗位决定可用工具，模型只能提出工具请求，不能直接访问数据库、文件系统或任意代码。

### 项目里的数据／状态流程

```text
模型提出工具动作
→ Tool Registry 校验工具是否注册、支持当前模式、风险和权限类型
→ Plugin Runtime 校验插件是否启用、依赖／冲突是否满足
→ Tool Policy 校验岗位、模式和工具白名单
→ 高风险写入动作进入审批；只读检索工具直接执行
→ ToolExecutionService 记录 tool.call
→ 执行超时、异常、幂等和结果外置处理
→ 写入 tool.result／tool.failed／tool.blocked
→ 结果回填 Agent Loop 或 LangGraph 状态
→ 继续下一轮或结束
```

当前典型工具：`bocha_web_search`（联网检索）、`dashscope_rerank`（重排）、`graph_search_tool`（图谱检索）、岗位知识检索工具、`citation_validate`（引用校验）、`artifact_generate`（Artifact 生成）。

### 面试怎么说

“工具不是模型返回一个函数名就直接执行，而是统一进入 ToolExecutionService。它把权限、审批、幂等、超时、审计和大结果外置统一收口。Agent Loop 只负责动作循环，工具本身和权限策略分离。”

代码入口：`backend/src/tools/tool-registry.ts`、`tool-execution-policy.service.ts`、`tool-execution.service.ts`、`backend/src/modules/agent-loop/agent-loop.service.ts`。

## 3．权限：在检索前和工具执行前分别控制

### 用户操作

管理员配置用户／角色／组织权限，文档上传时设置来源和作用域；工作流选择岗位和插件；普通用户只能看到自己有权限的知识和操作。

### 项目里的数据／状态流程

```text
请求进入
→ JWT 身份认证和用户／租户范围确定
→ 文档检索先做来源、生命周期、版本、角色和业务作用域过滤
→ 只把可访问证据交给模型
→ 工具执行前再做模式、岗位、插件白名单和 Tool Registry 校验
→ 写入型工具额外检查审批和幂等键
→ 权限拒绝写入 policy.denied／tool.blocked，不能靠模型自行绕过
```

### 面试怎么说

“权限不是只藏在 Prompt 里。知识权限在召回结果进入上下文前过滤，工具权限在执行前再次校验；即使模型要求调用未授权工具，也会被后端阻断。这样把数据访问控制和动作执行控制分开。”

代码入口：`DocumentPermissionService`、`ToolExecutionPolicyService`、`backend/src/modules/plugin-runtime/`、系统用户／角色／权限模块。

## 4．自动规则 Hooks：用事件驱动，不执行任意上传代码

这里的 Hooks 不是让后台上传 JavaScript 后直接运行，而是系统在固定生命周期节点自动发出事件，订阅者按白名单执行后续动作。

### 用户操作

管理员在后台配置事件订阅，例如工作流完成、文档生效、定时任务失败时通知企业微信；用户提交问题、工具调用或工作流审批时不需要手动点“记录日志”。

### 项目里的数据／状态流程

```text
文档／问答／工具／工作流发生状态变化
→ AgentRuntimeEventsService 写入运行事件（审计和运行中心）
→ 领域事件写入 PostgreSQL Outbox
→ 定时 Dispatcher 自动扫描 pending 事件
→ 按事件类型匹配已启用订阅
→ 企业微信／Webhook 通知
→ 成功标记 delivered；失败指数退避，最多 3 次后 failed
→ 管理员可在后台查看失败原因并人工重试
```

已接入的触发点包括：工作流审批／修订／完成／失败、定时任务完成／失败、文档审核／生效；Agent Loop 还会自动产生开始、轮次、工具、快照和终止事件，供运行中心展示。

### 面试怎么说

“我把 Hooks 做成可审计的领域事件和 Outbox，而不是开放任意代码执行。业务状态先落库，再异步通知；通知失败不会回滚主业务，靠幂等键、重试和失败人工补偿保证最终可达。”

代码入口：`backend/src/modules/domain-events/domain-events.service.ts`、`backend/src/modules/agent-runtime-events/agent-runtime-events.service.ts`、`docs/architecture/DOMAIN_EVENT_OUTBOX_USAGE.md`。

## 5．四者如何配合

```text
用户问题
→ 记忆层装配上下文
→ Simple 固定检索；Auto 判断是否升级；Chat Agentic／Task Agentic 进入受控 Loop
→ Loop 需要补证时提出工具动作
→ 权限和工具策略决定能否执行
→ 工具结果回填上下文，继续生成或交付 Artifact
→ 运行事件、Checkpoint、Query Log 和 LangFuse／Prometheus 记录全过程
→ 状态变化触发 Outbox Hook，通知运营人员或进入后续运营流程
```

最核心的边界：记忆负责“带什么上下文”，工具负责“做什么动作”，权限负责“能不能做”，Hooks 负责“发生状态变化后自动记录和通知”；四者职责不混在 Prompt 里。

## 6．后台从哪里看

- 记忆：`AI 智能问答 → 个人中心／记忆`。
- 工具和插件：`Agent 运营 → 平台治理`。
- 工具调用和 Loop：`Agent 运营 → 运行中心 → 运行详情`。
- 权限：`系统管理 → 用户／角色／权限`，以及文档的权限和作用域配置。
- Hooks／通知：`系统管理 → 通知` 或 Agent 运营的领域事件／Outbox 管理入口。

## 7．当前限制

- Redis 或 Mem0 未启用时，系统会按降级策略减少短期／长期记忆能力，不阻断基础问答。
- Hooks 当前只允许固定事件和企业微信／Webhook 出站，不执行任意脚本。
- 真正生产环境还需要配置告警规则、值班系统、长期数据留存和企业 IAM；本地代码已保留接入入口。
