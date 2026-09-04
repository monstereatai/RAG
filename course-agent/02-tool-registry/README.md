# 第 2 节讲义 · 工具治理 I：Tool Registry 与执行策略

> 课程：《从零手撕企业级 AI Agent》第 2 节 · 工具治理 I
> 源码：[tool-registry.ts](../../backend/src/tools/tool-registry.ts) · [tool-execution-policy.service.ts](../../backend/src/tools/tool-execution-policy.service.ts) · [tool-execution.service.ts](../../backend/src/tools/tool-execution.service.ts) L52-88
> 先修：第 1 节架构总览

## 一、痛点引出

给 Agent 接工具，最大的风险不是"接不上"而是"管不住"：一个能发邮件、能写数据库的工具，如果 Agent（或提示注入攻击者）能随意调用，等于把生产环境钥匙交给了一个不确定的概率系统。**工具面 = 攻击面**。本节的答案：工具不是函数，是带完整档案的一等公民——注册、审查、按模式/角色/插件三维度授权，默认拒绝。

## 二、整体架构：注册 → 策略 → 执行三层

```
Tool Registry（静态档案：11 字段元数据）
        ↓
ToolExecutionPolicyService（动态决策：四道闸，纯函数）
        ↓
ToolExecutionService（执行外壳：审计事件 → 审批 → 幂等 → 执行）  ← 第 3 节
```

## 三、代码拆解

### 3.1 注册条目：11 个字段就是 11 道问询（tool-registry.ts L1-13）

```ts
export interface ToolRegistryEntry {
  name: string;
  source: 'builtin' | 'mcp' | 'external';   // 来源：内置 / MCP / 外部 API
  risk: 'low' | 'medium' | 'high';           // 风险等级
  permission: 'read' | 'write' | 'external_read';  // 权限性质
  timeoutMs: number;                          // 超时
  audit: boolean;                             // 是否审计
  fallback: string;                           // 人话降级文案
  owner: string;                              // 负责人
  modes: Array<'simple' | 'auto' | 'agentic' | 'production'>;  // 可用链路
  roles?: string[];                           // 岗位限制
  requiresApproval?: boolean;                 // 写入类需审批
}
```

**教学引导语**：注册一个工具 = 回答 11 个问题。看真实样例 `bocha_web_search`（L16-26）：external 来源、medium 风险、external_read 权限、10 秒超时、fallback 是一句**给人看的降级说明**（"跳过联网搜索，继续使用本地 RAG / BM25 / ES 证据"）——注意 fallback 不是代码是一个字符串：它不是给机器执行的，是给排障的人和运营面板看的**降级语义声明**。`owner: 'rag-backend'` 意味着这个工具挂了找谁。

### 3.2 modes 的精妙：工具不是全链路可用（L62-71）

`citation_validate`（引用校验）的 modes 只有 `['agentic']`——**Simple 链路根本不允许调它**。为什么？Simple 是极速路径，引用校验的 3 秒开销不值得；Agentic 深度链路才需要。工具的可用范围是产品决策，落在注册元数据里，而不是散落在各处 if 判断。

### 3.3 策略四道闸：默认拒绝（tool-execution-policy.service.ts L21-41）

```ts
decide(toolName, context): ToolPolicyDecision {
  const entry = toolRegistry.find((item) => item.name === toolName);
  if (!entry) return { allowed: false, ... '工具未在 Tool Registry 注册，按默认拒绝策略阻断。' };  // 闸 1
  if (!entry.modes.includes(context.mode)) return { allowed: false, ... };  // 闸 2：模式
  if (context.pluginKeys?.length && !context.allowedToolNames?.includes(toolName))
    return { allowed: false, ... };  // 闸 3：插件白名单
  if (entry.roles?.length && (!context.role || !entry.roles.includes(context.role)))
    return { allowed: false, ... };  // 闸 4：岗位
  return { allowed: true, entry, requiresApproval: Boolean(entry.requiresApproval), ... };
}
```

四道闸的顺序有讲究：**从便宜到贵**——注册表查找（内存）→ 模式比对（内存）→ 插件白名单 → 角色校验，全部通过才谈审批。整个函数是**纯函数**（无 IO、无状态），单测不需要 mock 任何东西。拒绝理由全部是人类可读的句子，直接进审计事件。

### 3.4 fail-closed：未注册 = 拒绝（L23-25）

第一道闸是本节的灵魂：**找不到注册条目直接拒绝**。反面设计是"未注册的工具放行但打个警告日志"——提示注入让模型调一个 `rm_files`，警告日志救不了你。安全设计的第一原则：**默认关闭（fail-closed），显式开启**。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：新工具忘注册 → 运行时才发现被拒

- **现象**：新写的工具在 Agent 里死活调不通，审计事件里 `tool.blocked`，理由"工具未在 Tool Registry 注册"。
- **根因**：工具实现与注册是两个动作，靠人记住——忘了注册的实现代码完全正常，只有运行时被闸 1 拦下。
- **排查三步**：查 `tool.blocked` 事件的 reason → 对照 tool-registry.ts 确认条目存在 → 检查 name 拼写（注册名 ≠ 函数名时最容易错）。预防：工具 PR 模板里放"已注册"勾选项，或启动时校验实现与注册表的一致性。

### 坑点 2：modes 配漏 → 特定链路工具被拒

- **现象**：工具在 agentic 链路正常，切到 simple 模式全部 blocked，且理由是"工具不允许在 simple 链路执行"。
- **根因**：modes 数组配错（如只写了 `['agentic']`）——这是**配置错误**而非 bug，但表现为"随机失效"（只在某些模式触发）。
- **排查三步**：看 blocked reason（四道闸的拒绝理由精确指认是哪一道）→ 核对注册条目 modes → 想清楚这个工具的产品定位：哪些链路真的该用（对照 citation_validate 案例）。

## 五、讲师口播稿（约 300 字）

> 这一讲回答一个企业里真实被问过的问题：为什么不能直接把工具函数给模型调？我反问三句：这个工具能写数据库吗？能发邮件吗？能花钱吗？只要有一个是，你就得回答：谁允许它调的？在什么场景允许？出了事找谁？这就是 Tool Registry 存在的意义——每个工具入职都要填一份档案，十一个字段：从哪来、风险多高、读写还是只读、超时多少、挂了怎么降级、负责人是谁、允许在哪些链路跑、哪些岗位能用、要不要人工审批。然后是执行策略，四道闸，一道比一道贵：没注册的，直接拒绝，默认关闭；注册了的，查模式；带了插件组合的，查白名单；最后查岗位。四道全过，才轮到审批和执行。记住这一讲的一句话：工具面就是攻击面，你的 Agent 有多能干，攻击者就有多大的舞台。治理不是拖慢开发，是让"能干"可以安全地发生。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 2 节](../README.md)）：注册自己的工具 + 无权限调用 + requiresApproval 观察
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
