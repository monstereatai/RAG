# Agent、多 Agent、Function Calling、Tools、MCP Server、Skill 面试手册

更新时间：2026-08-04

## 一、六个概念先讲成人话

```text
Function Calling：模型用什么结构表达“我要调用哪个能力”。
Tool：宿主真正可以执行的原子能力。
MCP Server：不同 AI Host 用统一协议发现和调用外部工具、资源、提示模板。
Skill：完成一类任务的可复用 SOP，规定何时用哪些工具、按什么步骤做、如何验收。
Agent：围绕目标持续感知状态、做决策、调用能力并根据结果推进任务的系统。
多 Agent：多个职责、上下文或工具边界不同的 Agent，通过协议和工作流协作完成任务。
```

| 概念             | 所在层     | 解决的问题                       | 典型内容                       | 谁执行                 |
| ---------------- | ---------- | -------------------------------- | ------------------------------ | ---------------------- |
| Function Calling | 模型交互层 | 模型如何输出调用意图             | 工具名、JSON 参数、调用 ID     | 模型提意图，宿主执行   |
| Tool             | 能力层     | 系统具体能做什么                 | 搜索、查订单、写文件、发消息   | Tool Runtime／业务服务 |
| MCP Server       | 协议接入层 | 外部能力如何被多个 Host 统一接入 | Tools、Resources、Prompts      | MCP Client 调 Server   |
| Skill            | 任务方法层 | 一类工作怎样稳定完成             | 触发条件、步骤、工具组合、验收 | Agent／Harness 编排    |
| Agent            | 任务执行层 | 怎样围绕目标连续决策并完成任务   | Goal、State、Policy、Loop      | Harness 驱动模型与工具 |
| Multi-Agent      | 协作编排层 | 多个专业角色怎样分工和汇总       | Role、Contract、DAG、Handoff   | Orchestrator 编排      |

最容易记住的类比：

```text
Function Calling 像“调用申请单的格式”。
Tool 像“一个具体动作”。
MCP Server 像“统一插座和设备目录”。
Skill 像“标准作业手册”。
Agent 像“根据目标、状态和反馈推进任务的人”。
多 Agent 像“有明确职责、交付物和协作规则的项目团队”。
```

完整调用链：

```text
用户目标
  -> Router 判断普通代码、单 Agent 还是多 Agent
  -> Agent 选择 Skill 或直接处理
  -> Skill 要求使用某个 Tool
  -> Host 把 Tool Schema 交给模型
  -> 模型通过 Function Calling 生成 toolName + arguments
  -> Host 做参数、权限、预算和审批校验
  -> 本地 Tool Runtime 或 MCP Client 执行
  -> MCP Server／业务 API 返回结构化结果
  -> Agent 更新状态，继续或停止
  -> Evaluator 验证业务结果
```

## 二、Function Calling

### 2.1 是什么

Function Calling 不是让模型直接执行函数，而是让模型生成结构化调用请求。宿主收到请求后校验参数、检查权限、调用真实函数，再把结果作为 Observation 交回模型。

```text
用户：“查询上海明天的天气”
模型：get_weather({ city: "上海", date: "明天" })
宿主：校验并执行
工具：{ temperature: 31, condition: "多云" }
模型：“上海明天预计 31℃，多云。”
```

### 2.2 最小伪代码

```ts
// 这里只把工具契约交给模型，execute 实现和凭证始终留在宿主侧。
const functions = [
  {
    name: "search_knowledge",
    description: "检索活动规则、接口和设计规范；只读，不修改文档",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "完整、可独立理解的问题" },
        topK: { type: "integer", minimum: 1, maximum: 20 },
        department: {
          type: "string",
          enum: ["product", "design", "frontend", "backend", "qa", "ops"],
        },
      },
      required: ["query"],
    },
  },
];

// messages 同时保存模型决策和 Tool Observation，下一轮才能基于真实结果继续判断。
let messages = [{ role: "user", content: userQuestion }];

// MAX_STEPS 是 Harness 的硬停止条件，不能让模型自行决定是否无限继续。
for (let step = 0; step < MAX_STEPS; step++) {
  const response = await model.chat({ messages, tools: functions });
  // 没有 Tool Call 表示模型已经准备直接回答，循环在这里正常结束。
  if (!response.toolCalls?.length) return response.text;

  for (const call of response.toolCalls) {
    // 模型输出不可信：先校验参数，再检查用户权限和任务预算。
    const args = validate(call.name, call.arguments);
    authorize(currentUser, call.name, args);
    checkBudget(taskId, call.name);

    // 真实执行发生在宿主 Tool Runtime，并受统一超时保护。
    const result = await withTimeout(
      toolRegistry.execute(call.name, args),
      TOOL_TIMEOUT_MS,
    );

    // Tool Call 和对应结果必须通过 call.id 成对回写，避免并行调用时串结果。
    messages.push({ role: "assistant", toolCall: call });
    messages.push({
      role: "tool",
      toolCallId: call.id,
      content: toJson(result),
    });
  }
}

// 超过步数仍未完成属于受控失败，交给降级或人工接管，不能静默伪装成功。
throw new MaxStepsExceededError();
```

### 2.3 Function Schema 怎么设计

1. **一个函数只做一个动作**：使用 `search_documents`、`create_review_task`，不要用 `manage_everything({ action, data })`。
2. **描述写清什么时候用**：写触发场景、禁止场景和前置条件，不只写“这是搜索工具”。
3. **收紧参数空间**：使用 `enum`、必填、数字范围、ISO 日期、明确时区和业务 ID。
4. **区分读写**：读取可以有限重试，写操作要求幂等键，高风险写操作要求审批。
5. **返回稳定结构**：统一 `ok／data／error／meta`，不要把完整网页、日志或数据库对象塞回上下文。

```ts
// ToolResult 把业务成功与传输成功分开；HTTP 200 不代表业务动作完成。
type ToolResult<T> = {
  ok: boolean;
  data?: T;
  // error.code 供 Harness 决定修参、重试、降级还是终止。
  error?: {
    code: "INVALID_ARGUMENT" | "FORBIDDEN" | "TIMEOUT" | "UPSTREAM_ERROR";
    message: string;
    retryable: boolean;
  };
  // meta 用于链路追踪、性能统计和证据来源定位，不直接参与业务判断。
  meta: { requestId: string; durationMs: number; source?: string };
};
```

### 2.4 常见业务场景

| 场景         | Function Call 示例                                                        |
| ------------ | ------------------------------------------------------------------------- |
| 企业知识问答 | `search_knowledge`、`get_document_chunk`、`rerank_chunks`                 |
| 客服 Agent   | `get_order`、`query_refund_policy`、`create_ticket`                       |
| 游戏活动     | `search_activity_rules`、`check_region_policy`、`create_launch_checklist` |
| 数据分析     | `run_metric_query`、`get_dashboard_snapshot`、`export_excel`              |
| 研发 Agent   | `search_code`、`read_file`、`run_tests`、`create_pull_request`            |
| 办公协作     | `get_calendar`、`create_meeting`、`send_notification`                     |

### 2.5 面试回答

> Function Calling 本质是受约束的结构化输出。模型只生成工具名和 JSON 参数，宿主负责 Schema 校验、权限、超时、幂等、审批、审计和真实执行。它解决的是“模型怎么表达调用意图”，不是工具如何跨平台接入。

## 三、Tool

### 3.1 是什么

Tool 是 Agent 可以使用的原子能力，可以是本地函数、HTTP API、数据库查询、检索器、浏览器、代码执行器，也可以由 MCP Server 提供。

完整 Tool 应包含：名称、描述、输入输出 Schema、执行器、权限、风险级别、超时、重试、幂等、成本预算、审计、降级和评测。

### 3.2 Tool Registry 伪代码

```ts
// Registry 保存模型可见契约和宿主执行策略，避免每个 Agent 各写一套治理逻辑。
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: "read" | "write" | "high-risk";
  timeoutMs: number;
  maxRetries: number;
  requiredPermissions: string[];
  execute: (
    input: unknown,
    context: ToolContext,
  ) => Promise<ToolResult<unknown>>;
};

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition) {
    // 工具名是模型调用和审计的稳定主键，不允许重复覆盖。
    assertUnique(tool.name);
    this.tools.set(tool.name, tool);
  }

  listFor(user: User, agentRole: string) {
    // 先按真实用户权限和 Agent 角色裁剪，再把最小 Tool Schema 暴露给模型。
    return [...this.tools.values()]
      .filter((tool) => hasPermissions(user, tool.requiredPermissions))
      .filter((tool) => rolePolicyAllows(agentRole, tool.name))
      .map(toModelToolSchema);
  }

  async execute(name: string, rawInput: unknown, context: ToolContext) {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolNotFoundError(name);

    // 模型参数必须按 Schema 重新解析，不能把 unknown 直接传给业务 Service。
    const input = validateSchema(tool.inputSchema, rawInput);
    authorize(context.user, tool.requiredPermissions);
    requireApprovalWhenNeeded(tool.risk, context.approval);
    enforceRateLimit(context.tenantId, name);

    // 只有策略允许安全重试的动作才能进入 retryWhenSafe；写操作还必须有幂等键。
    return traceToolCall(name, () =>
      retryWhenSafe(
        () => withTimeout(tool.execute(input, context), tool.timeoutMs),
        tool.maxRetries,
      ),
    );
  }
}
```

### 3.3 Tool 怎么拆

- 按业务动作拆，例如 `query_activity_inventory`、`create_test_plan`，不要直接暴露万能 `execute_sql`、`http_post`、`run_any_shell_command`。
- 读工具可自动执行并有限重试；低风险写工具需要幂等；高风险写工具展示执行计划并人工确认。
- Tool 层只做 AI 适配与治理，核心业务仍调用现有 Service，避免 Web、后台和 Agent 各写一套规则。

```ts
// Tool 只做 AI 协议适配，真正业务规则继续复用现有 Service。
const createReviewTaskTool = defineTool({
  name: "create_review_task",
  inputSchema: CreateReviewTaskSchema,
  execute: (input, ctx) => reviewTaskService.create(input, ctx.user.id),
});
```

### 3.4 Tool 失败怎么处理

```ts
// 错误码必须先归类，因为不同错误对应不同恢复策略，不能全部无脑重试。
switch (error.code) {
  case "INVALID_ARGUMENT":
    // 参数错误只允许模型修复有限次数，避免修参死循环。
    return askModelToRepairArgumentsOnce();
  case "UNAUTHORIZED":
  case "FORBIDDEN":
    // 权限失败不可通过重试解决，应立即停止并解释。
    return stopAndExplain();
  case "RATE_LIMITED":
    return retryWithBackoffOrFallback();
  case "TIMEOUT":
    // 超时不代表写操作没成功；仅只读或幂等操作才能直接降级／重试。
    return fallbackToCacheOrSecondaryTool();
  case "CONFLICT":
    return reloadStateAndAskForConfirmation();
  default:
    return handoffToHuman();
}
```

重试前必须判断副作用。查数据可以有限重试；创建订单、发消息、发布内容必须依靠幂等键防止重复执行。

### 3.5 Tool 评测

- Tool selection accuracy：有没有选对工具。
- Argument accuracy：参数是否完整且符合业务语义。
- Tool success rate：工具真实执行成功率。
- Business outcome rate：业务目标是否真正达成。
- P50／P95、retry／fallback rate、human handoff rate。
- Cost per successful task：每个成功任务的模型与工具成本。

### 3.6 面试回答

> Tool 是 Agent 的原子执行能力。我通过 Tool Registry 统一管理 Schema、角色白名单、权限、超时、重试、幂等、审批、指标和审计。Tool 只做 AI 适配，核心业务规则复用 Service；读写工具分开，高风险动作不能只靠 Prompt 约束。

## 四、MCP Server

### 4.1 是什么

MCP Server 把外部工具和上下文按统一协议暴露给 AI Host。Host 可以是 IDE、桌面 Agent、企业工作台或自研 Runtime。Host 中的 MCP Client 负责连接 Server、发现能力并调用。

```text
AI Host
  ├── Model
  ├── Agent Harness
  └── MCP Client
        ↓ 标准协议
      MCP Server
        ├── Tools：可执行动作
        ├── Resources：可读取上下文
        └── Prompts：可复用提示模板
              ↓
        RAG API／Git／数据库／工单／内部平台
```

```text
Function Calling 解决：模型如何表达“我要调 rag_search”。
MCP 解决：Host 如何发现 rag_search、获得 Schema，并调用它的实现。
```

MCP Server 不等于 Agent，也不负责决定何时调用工具，决策通常仍在 Host／Agent Harness。

### 4.2 最小伪代码

```ts
// MCP Server 是协议适配层：声明能力、接收请求、调用后端，不负责 Agent 决策。
const server = new McpServer({ name: "enterprise-rag", version: "1.0.0" });

// Tool 适合“带参数的动作”；输入 Schema 会被 Host 发现并提供给模型。
server.tool(
  "rag_search",
  {
    description: "搜索企业知识库，返回带来源的相关片段",
    inputSchema: {
      query: string().min(2),
      topK: number().int().min(1).max(20).default(5),
    },
  },
  async (input, context) => {
    // 根据当前用户取短期凭证，不能把 Server 的超级权限或明文密钥交给模型。
    const token = await credentialProvider.get(context.user);
    const result = await ragApi.search(input, { token });
    return {
      // content 兼容模型阅读，structuredContent 供 Host 稳定解析和二次处理。
      content: [{ type: "text", text: JSON.stringify(result.items) }],
      structuredContent: result,
    };
  },
);

// Resource 是可寻址只读上下文；Prompt 是可复用任务模板，它们不等同于 Tool。
server.resource("project://architecture", () => readArchitectureSummary());
server.prompt("game_activity_plan", schema, (input) =>
  buildActivityPrompt(input),
);

// Transport 只决定通信方式；业务能力定义不应绑死 stdio 或 HTTP。
await server.connect(new StdioTransport());
```

### 4.3 MCP Server 怎么设计

1. **按业务域划分**：如 `rag-mcp-server`、`project-mcp-server`、`analytics-mcp-server`，不要把全公司接口塞进一个 Server。
2. **正确选择 Primitive**：有参数或动作使用 Tool；可寻址只读上下文使用 Resource；复用任务模板使用 Prompt。
3. **协议层保持轻薄**：MCP Handler 做身份、参数和结果适配，业务规则留在后端 Service／API。
4. **透传身份与租户**：Server 不能默认超级管理员，下游检索过滤和权限仍需生效。
5. **版本和契约测试**：记录 Server 版本，新增字段优先保持可选，测试工具列表、Schema 和返回结构。
6. **凭证不进模型**：模型只拿凭证引用，明文密钥留在 Server 或 Credential Provider。

```ts
// 这是 Host 认证后的运行上下文，不由模型生成，也不暴露真实凭证内容。
type McpRequestContext = {
  userId: string;
  tenantId: string;
  roles: string[];
  traceId: string;
  credentialRef: string; // 只传凭证引用，真正密钥由 Credential Provider 保管。
};
```

### 4.4 常见业务场景

| 场景           | MCP Server 的价值                                                    |
| -------------- | -------------------------------------------------------------------- |
| AI Coding      | Codex、IDE Agent 统一访问代码规范、RAG、工单和组件文档               |
| 企业知识助手   | 多个桌面端和工作台复用同一检索服务                                   |
| 数据分析 Agent | 统一暴露指标目录、查询工具和报表资源                                 |
| 客服／运营     | 接入订单、政策、工单、活动状态等业务域                               |
| 多 Agent 协作  | 不同 Agent 通过相同工具契约访问共享能力                              |
| 本项目         | 暴露 `rag_search`、`rag_context`、`rag_graph_query`、`rag_game_plan` |

### 4.5 什么时候不用 MCP

- 只有一个应用内部调用本地函数，没有跨 Host 复用需求。
- 极低延迟核心链路，额外协议层收益不足。
- 接口和业务边界尚未稳定。
- 只需普通后端 API，模型不需要发现或组合能力。

这时本地 Tool 或 HTTP Tool 更简单，不要为了出现 MCP 而增加空壳。

### 4.6 面试回答

> MCP 是 AI Host 与外部工具、资源、提示模板之间的标准接入协议。它解决能力发现、Schema 描述和跨客户端复用，不替代 Function Calling，也不等于 Agent。我的设计是按业务域拆 Server，协议层只做适配，权限和业务规则仍在后端，并补版本、契约测试、租户透传和审计。

## 五、Skill

### 5.1 是什么

Skill 是 Agent 的程序性记忆，即“遇到某类任务应该怎样做”。它包含触发描述、工作步骤、可用工具、输入输出、检查清单、失败处理和参考资料。

```text
Tool：搜索知识库。
Skill：完成活动上线方案时，先查历史方案和地区规则，再生成 PRD、接口、测试与发布清单，最后检查证据。

Prompt：这一次请求的上下文和要求。
Skill：可版本化、可选择、可组合工具、可检查步骤、可评测的任务方法。
```

### 5.2 Skill 定义伪代码

```yaml
# 元数据用于快速匹配 Skill；只有被选中后才加载完整步骤和参考资料。
name: game-activity-launch
description: 当用户需要设计、评审或上线游戏官网活动时使用
inputs: [activity_type, region, launch_date]
# 白名单限制 Skill 能提出哪些 Tool Call，但最终权限仍由宿主 Runtime 判断。
allowed_tools:
  - rag_search
  - rag_graph_query
  - create_prd
  - create_test_plan
  - create_release_checklist
steps:
  # 步骤描述业务 SOP，不把每一步都硬编码成不可变程序。
  - 读取项目规则、地区规则和历史复盘
  - 识别缺失信息与版本冲突
  - 生成产品、设计、前端、后端、测试、运营六岗位任务
  - 对高风险发布动作请求人工审批
  - 检查关键结论是否有引用证据
success_criteria:
  # 成功标准必须能被 Evaluator 或业务状态验证，不能只看模型说“完成了”。
  - 六岗位交付物齐全
  - 关键 Claim 有来源
  - 高风险项已审批或明确阻塞
  - 测试与发布检查清单已生成
fallback:
  # 降级策略明确系统做不到时怎样收口，避免证据不足仍然编造答案。
  - 证据不足时不承诺具体规则
  - 工具不可用时生成待人工补充清单
```

### 5.3 Skill 选择和执行伪代码

```ts
// 渐进式披露：常驻元数据用于低成本选择，不把所有 Skill 正文塞进上下文。
const catalog = loadSkillMetadataOnly();
const selected = await model.selectSkill({
  userGoal,
  availableSkills: catalog,
});
if (!selected) return runDefaultAgent(userGoal);

// 选中后才加载步骤和 references，并校验它声明的 Tool 是否来自可信 Registry。
const skill = loadFullSkill(selected.name);
assertAllowedTools(skill.allowedTools);
let state = createInitialState(userGoal, skill.inputs);

for (const step of skill.steps) {
  // Skill 给出“要完成什么”，模型在当前 State 下决定“这一步如何调用工具”。
  const action = await planStep(step, state, skill.allowedTools);
  const observation = await toolRuntime.execute(
    action.tool,
    action.args,
    state.context,
  );
  state = updateState(state, step, observation);

  // 审批前先做 Checkpoint，等待期间进程退出也可以从同一状态恢复。
  if (needsHumanApproval(step, state)) {
    state = await checkpointAndWaitForApproval(state);
  }
  if (shouldStop(state)) break;
}

// 最终按 Skill 的验收标准评分，而不是直接返回最后一次模型输出。
return evaluateAgainstCriteria(state.output, skill.successCriteria);
```

### 5.4 Skill 怎么设计

- 从重复出现、有稳定步骤、有明确输入输出和验收标准的真实 SOP 中提炼。
- 一次性任务不抽 Skill；单工具简单任务直接调用 Tool；完全确定的固定流程优先普通代码。
- 使用渐进式披露：常驻元数据，选中后加载正文，需要时再加载 references 和示例。
- 明确 Allowed Tools、风险动作、审批条件、失败降级和人工接管。
- 评测 Skill 选择准确率、必做步骤完成率、工具成功率、输出 Schema 和业务结果。

Skill 不等于子 Agent。一个 Agent 可以执行多个 Skill，一个 Skill 也可以编排多个岗位 Agent。

```text
单 Agent + Skill：一个角色完成稳定 SOP。
多 Agent + Skill：角色上下文和交付物确实不同。
普通代码 Workflow：路径固定、规则明确。
```

### 5.5 常见业务场景

| Skill      | 组合 Tool                                   | 业务结果             |
| ---------- | ------------------------------------------- | -------------------- |
| 客诉处理   | 查订单、查政策、创建工单、通知客服          | 完成可追踪客诉闭环   |
| 活动上线   | 查规则、生成 PRD、创建测试、发布检查        | 六岗位协作交付       |
| 数据分析   | 查指标、运行 SQL、绘图、导出 Excel          | 形成带口径的数据报告 |
| 故障排查   | 查日志、查指标、健康检查、创建事故单        | 定位根因并沉淀复盘   |
| Auto-coder | 读规范、搜索代码、修改文件、运行测试        | 产出验证通过的变更   |
| RAG 评测   | 导入数据、运行评测、聚类 Bad Case、对比版本 | 输出质量回归报告     |

### 5.6 面试回答

> Skill 是可复用的任务 SOP，不是一个工具。它描述何时触发、按什么步骤组合哪些 Tool、哪些动作审批、失败怎样处理、最后怎样验收。我会渐进式加载 Skill，并评测选择准确率、步骤完成率、工具成功率和业务结果。

## 六、Agent

### 6.1 是什么

Agent 不是“会聊天的模型”，而是围绕目标运行的系统：读取当前状态，决定下一步动作，调用 Tool／Skill，接收 Observation，更新状态，直到完成、失败、预算耗尽或人工接管。

```text
Chatbot：用户输入 -> 模型回复。
Workflow：预先定义步骤 -> 按规则执行。
Agent：目标 + 状态 + 动态决策 + 工具 + 反馈循环 + 停止条件。
```

| 组成            | 作用               | 例子                                     |
| --------------- | ------------------ | ---------------------------------------- |
| Goal            | 定义业务目标       | 生成可上线的活动方案                     |
| State           | 保存当前进度和事实 | 已检索证据、待审批风险、剩余预算         |
| Policy／Planner | 选择下一步         | 规则路由、模型规划、LangGraph 条件边     |
| Tools／Skills   | 提供行动能力和 SOP | RAG Search、创建测试计划、活动上线 Skill |
| Memory／Context | 提供当前和历史信息 | 对话、用户偏好、项目规范、Checkpoint     |
| Observation     | 返回真实执行结果   | API 响应、文件、数据库状态、错误         |
| Stop Condition  | 限制循环和风险     | 成功、拒答、超时、预算、人工接管         |
| Evaluator       | 判断是否真的完成   | 证据覆盖、产物完整、业务状态断言         |

### 6.2 Agent 最小循环伪代码

```ts
// State 是 Harness 可持久化、可审计的事实，不等同于模型的自然语言思考过程。
type AgentState = {
  goal: string;
  plan: PlanStep[];
  observations: Observation[];
  artifacts: ArtifactRef[];
  remainingSteps: number;
  remainingTokens: number;
  remainingCost: number;
  status: "running" | "waiting_approval" | "completed" | "failed";
  stopReason?: string;
};

async function runAgent(goal: string, context: AgentContext) {
  // 预算在任务开始时一次性注入，后续每轮和每次 Tool Call 都会扣减。
  let state = createInitialState(goal, context.budget);

  while (state.status === "running") {
    // 在调用模型前先执行硬门禁，避免已经超预算还继续产生费用。
    enforceBudget(state);
    detectNoProgressLoop(state);

    // 模型只看到压缩后的必要 State，以及当前用户和角色允许的最小能力集。
    const decision = await policy.decide({
      goal: state.goal,
      state: summarizeForModel(state),
      tools: toolRegistry.listFor(context.user, context.role),
      skills: skillCatalog.listFor(context.role),
    });

    if (decision.type === "finish") {
      // 模型声称完成不算完成；Evaluator 要检查证据、产物和业务状态。
      const evaluation = await evaluator.grade(state, decision.output);
      if (evaluation.passed)
        return complete(state, decision.output, evaluation);
      state = addFeedback(state, evaluation.feedback);
      continue;
    }

    if (decision.type === "ask_user") {
      // 等待用户属于可恢复状态，先保存 Checkpoint 再退出本次运行。
      return checkpointAndWait(state, decision.question);
    }

    // 模型的动作先过 Schema、权限、风险和预算校验，再交给 Tool Runtime。
    const action = validateDecision(decision, state, context);
    const observation = await toolRuntime.execute(
      action.tool,
      action.arguments,
      context,
    );
    // Reducer 是唯一状态写入口，保证重放同一轨迹时得到一致状态。
    state = reduceState(state, action, observation);
  }

  return state;
}
```

关键不是 `while`，而是预算、状态更新、停止条件和 Evaluator 必须由 Harness 控制，不能交给模型自由决定。

### 6.3 LangGraph 状态机伪代码

```ts
// 显式节点承载可观测业务步骤，条件边只读取结构化 State 决定下一跳。
const graph = new StateGraph<AgentState>()
  .addNode("route", routeByComplexity)
  .addNode("retrieve", retrieveEvidence)
  .addNode("judgeEvidence", judgeEvidenceSufficiency)
  .addNode("useTools", executeSelectedTools)
  .addNode("generate", generateGroundedAnswer)
  .addNode("verify", verifyClaimsAndCitations)
  .addNode("humanReview", waitForHumanReview)
  .addEdge(START, "route")
  .addConditionalEdges("route", (state) => state.route, {
    // 简单事实题走检索快路径；确需外部动作才进入受限 Tool 节点。
    simple: "retrieve",
    tool: "useTools",
    reject: END,
  })
  .addEdge("retrieve", "judgeEvidence")
  .addConditionalEdges("judgeEvidence", (state) => state.evidenceStatus, {
    // 证据不足时扩展能力，无答案时直接收口，不能强行生成。
    sufficient: "generate",
    insufficient: "useTools",
    no_answer: END,
  })
  .addEdge("useTools", "generate")
  .addEdge("generate", "verify")
  .addConditionalEdges("verify", (state) => state.verdict, {
    // 可修复问题回到检索，高风险结果交人工；通过后才结束。
    pass: END,
    retry: "retrieve",
    high_risk: "humanReview",
  })
  .addEdge("humanReview", END)
  // Checkpointer 让进程重启、人工等待和局部重跑都能恢复 State。
  .compile({ checkpointer: redisCheckpointer });
```

### 6.4 常见 Agent 模式

| 模式                 | 适合场景                       | 优点                 | 代价               |
| -------------------- | ------------------------------ | -------------------- | ------------------ |
| ReAct                | 路径未知，需要边观察边决策     | 灵活                 | 易循环，轨迹不稳定 |
| Plan-and-Execute     | 先规划再执行                   | 计划清晰、可检查     | 计划可能过时       |
| Router Agent         | 从固定能力中选路               | 简单、低成本         | 不适合长任务       |
| Workflow-first Agent | 主流程确定，少数节点让模型决策 | 稳定、可恢复、可审计 | 灵活性较低         |
| Reflection／Critic   | 生成后检查和修正               | 提高复杂产物质量     | 延迟和 Token 增加  |
| Human-in-the-loop    | 高风险动作或证据不足           | 降低错误影响         | 增加等待成本       |

本项目选择 Workflow-first：普通事实问答走 Simple RAG；复杂检索走 Agentic；六岗位协作走显式 DAG；只在查询扩展、充分性判断、工具选择和结构化产物等节点使用模型。

### 6.5 Agent 怎么设计

1. **先定义业务结果**：先写成功状态和不可接受结果，不从模型选型开始。
2. **拆确定与不确定部分**：固定规则写代码，语义判断和动态选择交给模型。
3. **设计显式 State**：证据、工具轨迹、预算、审批、产物、错误和终止原因都进入状态。
4. **限制行动空间**：按角色、用户、租户和当前 Skill 提供最小 Tool 集。
5. **定义停止条件**：成功、无答案、超时、预算、重复无进展和人工接管。
6. **支持 Checkpoint**：长任务和审批前持久化，可暂停、恢复和局部重跑。
7. **验证真实结果**：以数据库、文件、引用和业务状态为准，不以模型声称完成为准。

### 6.6 Agent 防死循环

```ts
function detectNoProgressLoop(state: AgentState) {
  // 三类硬预算分别限制轨迹长度、墙钟时间和真实费用。
  if (state.remainingSteps <= 0) stop("MAX_STEPS");
  if (elapsed(state) > state.maxDurationMs) stop("TIME_BUDGET");
  if (state.remainingCost <= 0) stop("COST_BUDGET");

  const recent = state.observations.slice(-3);
  // 不能只数轮次；相同动作且没有新证据，说明系统没有取得进展。
  if (sameActionAndArguments(recent) && noNewEvidence(recent)) {
    stop("REPEATED_ACTION_WITHOUT_PROGRESS");
  }

  // 反复重规划仍不收敛时转人工，而不是让 Planner 无限推翻自己。
  if (state.replanCount > MAX_REPLANS) {
    handoff("PLAN_NOT_CONVERGING");
  }
}
```

除了限制次数，还要判断是否有进展。如果没有新增证据、没有减少未完成项、没有改变业务状态，就不应继续循环。

### 6.7 常见业务场景

| Agent          | 动态决策                       | Tool／Skill              | 成功结果             |
| -------------- | ------------------------------ | ------------------------ | -------------------- |
| RAG Agent      | 是否扩展查询、联网、重排或拒答 | Search、Rerank、Citation | 带证据回答或正确拒答 |
| 客服 Agent     | 政策判断、工单路由、是否转人工 | Order、Policy、Ticket    | 客诉真实闭环         |
| 数据 Agent     | 选择指标、查询和分析步骤       | Metric、SQL、Excel       | 可复核分析报告       |
| Coding Agent   | 定位、修改、验证和修复         | Search、Edit、Test       | 测试通过的代码变更   |
| 运维 Agent     | 判断故障层级和处置路径         | Logs、Metrics、Runbook   | 恢复服务并形成复盘   |
| 游戏活动 Agent | 识别地区、角色、风险和交付物   | RAG、Graph、Artifact     | 可评审上线方案       |

### 6.8 Agent 评测指标

- Task success rate、step／trajectory accuracy。
- Tool selection／argument accuracy。
- Loop／timeout／handoff rate。
- Evidence coverage、policy compliance。
- P50／P95、Token、cost per successful task。
- Human rework／adoption rate。

### 6.9 面试回答

> Agent 不是会调用工具的 Chatbot，而是围绕目标运行的闭环系统：读取显式 State，按 Policy 决定动作，调用 Tool／Skill，消费 Observation，再根据停止条件继续或结束。我的设计采用 Workflow-first，固定流程由 LangGraph 和代码控制，模型只处理语义决策点；同时设置步骤、时间、Token、费用和重复调用预算，长任务用 Checkpoint 恢复，高风险动作人审，最终用真实业务状态和证据门禁评测。

## 七、多 Agent

### 7.1 是什么

多 Agent 不是复制多个相同 Prompt，也不是多个模型自由聊天。它把复杂目标拆给职责、上下文、工具权限或成功标准不同的执行单元，并通过明确协议编排依赖、交付物和失败处理。

```text
单 Agent：一个状态空间和一个决策主体，内部可使用多个 Skill。
多 Agent：多个职责边界和局部状态，通过 Contract／Artifact／Shared State 协作。
```

一个角色值得成为独立 Agent，至少应满足一项：独立专业知识和评测标准、独立上下文、独立 Tool 权限、可独立验收的产物，或可以并行并带来明显收益。只改变语气、共享全部上下文、步骤完全固定时不值得拆 Agent。

### 7.2 常见多 Agent 架构

| 架构           | 结构                   | 适合场景             | 主要风险             |
| -------------- | ---------------------- | -------------------- | -------------------- |
| Supervisor     | 主管动态选择 Worker    | 任务未知、专家池     | 主管成为瓶颈和单点   |
| Pipeline       | A 输出交给 B           | 内容生产、审核链     | 前序错误放大         |
| DAG／Workflow  | 显式依赖与并行批次     | 产研协作、审批、发布 | 图维护成本           |
| Handoff        | Agent 主动移交         | 客服转专家、领域路由 | 上下文丢失、来回移交 |
| Debate／Critic | 多方案生成、评审和裁决 | 高价值开放方案       | 成本高、结果可能趋同 |
| Blackboard     | Agent 读写共享任务板   | 长任务、异步协作     | 状态冲突和污染       |

本项目六岗位选择 DAG，而不是自由群聊：产品先执行；设计与后端可并行；前端等待产品、设计和后端契约；测试等待实现方案；运营汇总发布。重要风险才审批。

### 7.3 Agent Contract 伪代码

```ts
// Contract 把角色的输入、输出、能力和成功标准变成可验证边界。
type AgentContract<Input, Output> = {
  role: "product" | "design" | "frontend" | "backend" | "qa" | "operations";
  goal: string;
  inputSchema: Schema<Input>;
  outputSchema: Schema<Output>;
  allowedTools: string[];
  dependencies: string[];
  evidencePolicy: EvidencePolicy;
  approvalPolicy: "auto" | "risk_based" | "required";
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  successCriteria: BusinessAssertion[];
};

const backendAgent: AgentContract<BackendInput, BackendPlan> = {
  role: "backend",
  goal: "输出接口、数据、幂等、库存和风控方案",
  inputSchema: BackendInputSchema,
  outputSchema: BackendPlanSchema,
  // 后端 Agent 只能看到本角色必要的 Tool，避免跨岗位越权或误调用。
  allowedTools: ["rag_search", "rag_graph_query", "create_architecture"],
  // 依赖产品 Artifact，不依赖产品 Agent 的完整聊天历史。
  dependencies: ["product"],
  evidencePolicy: { minCoverage: 0.8, requireCitations: true },
  // 普通方案自动执行，只有命中风险规则的动作才进入审批。
  approvalPolicy: "risk_based",
  timeoutMs: 75_000,
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
  // 业务断言用于判断交付物是否真的合格，而不是只校验 JSON 格式。
  successCriteria: [hasApiContract, hasIdempotencyPlan, hasRiskList],
};
```

Agent 之间传经过 Schema 校验的交付物、引用、决策和未解决问题，而不是传整段聊天历史。

### 7.4 六岗位 DAG 伪代码

```ts
// DAG 用代码声明稳定依赖；没有依赖关系的设计和后端节点可以并行。
const workflow = defineAgentDag({
  nodes: { product, design, frontend, backend, qa, operations },
  edges: [
    ["product", "design"],
    ["product", "backend"],
    ["product", "frontend"],
    ["design", "frontend"],
    ["backend", "frontend"],
    ["frontend", "qa"],
    ["backend", "qa"],
    ["qa", "operations"],
  ],
});

async function runMultiAgentTask(input: ProjectBrief) {
  // 初始任务立即持久化，后续每批完成后都更新 Checkpoint。
  let state = await checkpointStore.create({
    input,
    completed: {},
    failed: {},
  });

  for (const batch of topologicalBatches(workflow)) {
    // 只调度依赖已通过的角色，阻止上游垃圾产物继续传播。
    const runnable = batch.filter((role) => dependenciesPassed(role, state));
    const results = await mapWithConcurrency(
      runnable,
      MAX_PARALLEL_AGENTS,
      async (role) => {
        const contract = workflow.nodes[role];
        // 每个角色只接收 Contract 声明的输入，并独立校验输出 Schema。
        const roleInput = buildContractInput(contract, state);
        const result = await runAgentWithContract(contract, roleInput);
        return validateOutput(contract.outputSchema, result);
      },
    );

    // 合并版本化 Artifact 后执行跨角色质量门禁，再保存可恢复状态。
    state = mergeArtifactsByRole(state, results);
    state = await qualityGate.evaluate(state);
    await checkpointStore.save(state);

    // 审批按风险触发，不要求每个岗位串行等待人工确认。
    if (state.requiresApproval) state = await waitForApproval(state);
    if (state.hasBlockingFailure) return handoffOrFail(state);
  }

  return finalizeProjectArtifacts(state);
}
```

### 7.5 Supervisor 伪代码

```ts
async function supervisorLoop(task: Task, workers: WorkerAgent[]) {
  let state = createTeamState(task);

  while (!isTeamDone(state)) {
    // Supervisor 根据当前产物摘要动态选择专家，适合子任务无法预先确定的场景。
    const decision = await supervisor.decide({
      goal: task.goal,
      summaries: summarizeWorkerArtifacts(state),
      availableWorkers: workers.map(toWorkerCard),
      remainingBudget: state.budget,
    });

    if (decision.type === "delegate") {
      // Worker 名称和任务输入都必须校验，不能执行模型临时捏造的专家或参数。
      const worker = assertWorkerAllowed(decision.worker);
      const input = validateAssignment(decision.input, worker.inputSchema);
      const artifact = await worker.run(input);
      state = mergeValidatedArtifact(state, worker.role, artifact);
    } else if (decision.type === "finish") {
      // Supervisor 的汇总仍需 Team Evaluator 验证，不能自己宣布团队成功。
      return teamEvaluator.grade(state, decision.output);
    } else {
      // 无法安全决策时保存团队状态并向人澄清。
      return checkpointAndAskHuman(state, decision.question);
    }
  }
}
```

Supervisor 适合动态专家选择；稳定业务流程优先 DAG，否则主管每一步都调用模型，会增加延迟、成本和单点失败。

### 7.6 上下文和通信

```ts
// Artifact 是 Agent 间的稳定通信协议，用版本化事实替代无限增长的群聊。
type AgentArtifact = {
  artifactId: string;
  producerRole: string;
  version: number; // 下游记录消费版本，上游更新后才能计算影响范围。
  summary: string;
  structuredPayload: unknown;
  citations: Citation[];
  assumptions: string[];
  unresolvedQuestions: string[]; // 未解决问题必须显式传递，不能在摘要中丢失。
  quality: { passed: boolean; coverage: number };
};
```

- 每个 Agent 只获取本角色需要的上下文。
- 共享版本化 Artifact 和决策，不共享无限增长的群聊。
- 上游修改后增加版本，下游记录消费版本。
- 冲突用规则、仲裁或人工审批解决，不让最后发言者自动获胜。
- Shared State 由 Orchestrator 单写或用版本号／乐观锁防止并行覆盖。

### 7.7 失败、恢复和局部重跑

```ts
async function rerunRole(batchId: string, role: AgentRole) {
  // 从持久化状态恢复，避免重跑整个长任务。
  const state = await checkpointStore.load(batchId);
  // 当前角色变化会使所有下游产物失效，但无关分支可以保留。
  const affected = descendantsOf(role, workflow);

  invalidateArtifacts(state, [role, ...affected]);
  preserveUnaffectedArtifacts(state);

  const contract = workflow.nodes[role];
  const result = await runAgentWithContract(
    contract,
    buildContractInput(contract, state),
  );

  // 保存新版本产物后，从下一个依赖已满足的批次继续执行。
  await checkpointStore.save(mergeRoleResult(state, role, result));
  return resumeFromNextReadyBatch(state);
}
```

- 非关键角色失败可带警告继续，但不能伪装成功。
- 关键依赖失败必须阻止下游，避免垃圾输入传播。
- 进程重启从 Checkpoint 恢复，不重复已完成写操作。
- 局部重跑失效当前角色和受影响下游，保留无关产物。
- 写 Tool 使用任务 ID＋角色＋步骤生成幂等键。

### 7.8 多 Agent 评测

- Team task success rate、agent success rate。
- Dependency correctness、handoff accuracy。
- Artifact completeness、evidence coverage。
- Coordination overhead：协调 Token、消息、重复工作和等待。
- Parallel efficiency：并行相对串行的时延收益。
- Rework／approval／handoff rate。
- End-to-end P95、cost per successful team task。

必须与单 Agent Baseline 比较。质量没有提升、成本和耗时却成倍增加时，应合并角色或回到单 Agent／Workflow。

### 7.9 常见业务场景

| 场景          | Agent 分工                          | 编排方式              |
| ------------- | ----------------------------------- | --------------------- |
| 游戏活动产研  | 产品、设计、前端、后端、测试、运营  | DAG＋风险审批         |
| 软件研发      | Planner、Coder、Reviewer、Tester    | Pipeline／DAG         |
| Deep Research | Researcher、Analyst、Writer、Critic | Supervisor＋Pipeline  |
| 客服中心      | Router、订单、政策、技术支持        | Handoff／Supervisor   |
| 数据分析      | 指标专家、SQL、分析、报告           | Plan-and-Execute／DAG |
| 事故响应      | 监控、应用、数据库、网络、指挥      | Blackboard＋人工指挥  |

### 7.10 面试回答

> 多 Agent 不是多个模型自由聊天，而是多个有独立职责、上下文、工具权限和交付标准的执行单元，通过 Contract 和 Orchestrator 协作。我只有在专业边界、权限、上下文隔离、独立产物或并行收益真实存在时才拆 Agent。项目六岗位采用显式 DAG：上游产出版本化 Artifact，下游按 Schema 消费；关键失败阻塞下游；Checkpoint 支持恢复和局部重跑；重要风险才审批。评测既看团队成功，也看协调开销，并与单 Agent Baseline 比较。

## 八、六层组合业务案例

用户提出：“请为东南亚服周年庆抽奖活动生成完整上线方案，下周五发布。”

1. Agent 选择 `game-activity-launch` Skill，因为任务包含地区规则、多个岗位和上线检查。
2. Skill 要求先查询东南亚限制、历史复盘和奖励风险。
3. 模型生成 Function Call：

```jsonc
{
  // name 必须来自当前用户可见的 Tool Schema，不能由模型自由发明。
  "name": "rag_search",
  "arguments": {
    // query 要能脱离聊天历史独立理解，减少检索器对隐含上下文的依赖。
    "query": "东南亚服周年庆抽奖活动的地区限制、奖励规则和历史风险",
    "topK": 8,
    // filters 进入后端权限和元数据过滤链路，不替代租户级强制隔离。
    "filters": { "region": "Southeast Asia" },
  },
}
```

4. Host 校验后通过 MCP Client 调用 `rag-mcp-server` 中的 Tool。
5. MCP Server 调 RAG 后端的 Hybrid Search、Reranker 和权限过滤，返回带引用证据。
6. Skill 编排产品、设计、前端、后端、测试、运营六岗位交付物。
7. 奖励概率、库存和外部发布等高风险动作 checkpoint 后人工审批，普通任务不强制审批。
8. 最后检查证据覆盖、产物完整、测试清单、发布清单和真实任务状态。

## 九、方案怎么选

| 需求                           | 推荐方案                     | 原因                     |
| ------------------------------ | ---------------------------- | ------------------------ |
| 应用内调用一个稳定函数         | 本地 Tool + Function Calling | 链路最短                 |
| 调用现有 HTTP API              | HTTP Tool + Function Calling | 不需要额外协议层         |
| 多个 AI Host 复用能力          | MCP Server                   | 统一发现、Schema 和调用  |
| 一类任务需要固定步骤和多个工具 | Skill + Tools                | 固化 SOP 和验收          |
| 路径固定、规则明确             | 普通代码 Workflow            | 更稳、更便宜             |
| 路径动态、观察后再决策         | Agent／LangGraph + Tools     | 需要状态、分支和有限循环 |
| 多角色交付物明显不同           | 多 Agent／岗位 DAG           | 角色边界带来真实收益     |

不要回答“全部用 MCP + 多 Agent + Skill”。高级工程师要主动减少不必要的 Agent 化。

## 十、生产级检查清单

### Function Calling

- 描述能否让模型判断何时调用、何时不调用。
- Schema 是否有必填、枚举、范围、格式和时区。
- 是否限制并行调用数、总步骤数和参数修复次数。

### Tool

- 是否按业务能力拆分，读写是否分级。
- 权限、审批、幂等、超时、重试、熔断是否落到代码。
- 输出是否结构化、裁剪、脱敏。
- 是否有 Trace、成功率、P95、成本和 Bad Case。

### MCP Server

- 是否有清晰业务域，Tool／Resource／Prompt 是否选对。
- 是否复用业务 API，而不是复制规则。
- 用户、租户和权限是否透传。
- 是否有版本、契约测试和连接恢复。
- 密钥是否留在 Server，不进入模型上下文。

### Skill

- 触发条件能否与相似 Skill 区分。
- 步骤是否来自真实 SOP，而不是长 Prompt 改名。
- Allowed Tools、审批、降级和成功标准是否明确。
- 是否渐进式加载并评测选择、步骤和业务结果。

### Agent

- Goal、State、Policy、Observation 和 Stop Condition 是否显式。
- 固定流程是否写进代码，模型是否只负责真正不确定的决策。
- 是否有步骤、时间、Token、费用、重规划和重复调用预算。
- 是否支持 Checkpoint、恢复、人工接管和真实结果评测。

### Multi-Agent

- 拆分是否来自职责、权限、上下文、交付物或并行收益。
- Agent Contract、Artifact Schema、依赖和版本是否明确。
- 关键失败是否阻塞下游，能否局部重跑且不重复副作用。
- 是否与单 Agent Baseline 比较质量、P95、成本和协调开销。

## 十一、MCP 生命周期与能力协商

### 11.1 三个阶段

MCP 连接不是一上来就调用 `tools/call`，而是经过初始化、运行、关闭三个阶段：

```text
Initialization
  Client -> initialize(protocolVersion, capabilities, clientInfo)
  Server -> InitializeResult(protocolVersion, capabilities, serverInfo)
  Client -> notifications/initialized

Operation
  list/get/call tools、resources、prompts
  progress、logging、listChanged、cancelled 等通知

Shutdown
  stdio：关闭 stdin，等待退出，必要时 SIGTERM／SIGKILL
  HTTP：关闭相关连接或结束会话
```

初始化必须是 Client 和 Server 的第一次协议交互。双方在此阶段确认协议版本、能力和实现信息；收到 `initialized` 通知前，不应开始普通工具调用。

### 11.2 初始化伪代码

```ts
// initialize 必须是连接建立后的第一条协议请求，用于协商版本和双方能力。
const initResult = await transport.request({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: SUPPORTED_PROTOCOL_VERSION,
    // Client 只声明自己真正实现的能力；空对象表示支持该能力族的基础功能。
    capabilities: {
      roots: { listChanged: true },
      sampling: {},
      elicitation: {},
    },
    clientInfo: { name: "rag-agent-host", version: "1.0.0" },
  },
});

// 协议版本不兼容时立即关闭连接，不能带着错误假设继续调用 Tool。
if (!supportedVersions.includes(initResult.protocolVersion)) {
  await transport.close();
  throw new ProtocolVersionMismatchError();
}

// 后续只能使用双方能力交集，不能仅凭 SDK 存在某个方法就直接调用。
const negotiated = intersectCapabilities(
  clientCapabilities,
  initResult.capabilities,
);

// initialized 是 Notification，没有 id；发送后才进入普通 Operation 阶段。
await transport.notify({
  jsonrpc: "2.0",
  method: "notifications/initialized",
});
```

### 11.3 能力协商怎么讲

Client 常见能力包括：

- `roots`：向 Server 提供可访问的文件系统根目录。
- `sampling`：允许 Server 请求 Host 使用模型生成内容。
- `elicitation`：允许 Server 请求用户补充结构化信息。

Server 常见能力包括：

- `tools`、`resources`、`prompts`。
- `logging`、`completions`。
- `listChanged`：能力列表变化时发送通知。
- `subscribe`：订阅某个 Resource 的变化。

不能只看 SDK 是否有某个方法，必须先确认协商结果里双方都支持。HTTP 后续请求还要携带协商后的 `MCP-Protocol-Version`。

### 11.4 超时、取消、进度和恢复

```ts
// 每个 Tool Request 同时绑定超时和 Progress 回调，UI 进度不等于业务完成。
const request = client.callTool(input, {
  timeoutMs: 30_000,
  onProgress: (progress) => updateUi(progress),
});

try {
  return await request;
} catch (error) {
  if (error instanceof TimeoutError) {
    // 本地停止等待后显式通知 Server 取消，避免远端继续消耗资源。
    await client.notifyCancelled(request.id, "deadline exceeded");
  }
  // 取消后仍向上抛出，让上层决定重试、降级还是转人工。
  throw error;
}
```

- 每个请求设置独立超时，同时保留绝对最大时限。
- 收到 Progress 可以延长空闲超时，但不能无限延长总时限。
- 网络断开不等于业务取消，取消要显式发送 Cancellation Notification。
- Streamable HTTP 可用事件 ID 和 `Last-Event-ID` 做流恢复，但写操作仍要靠幂等键处理“不知道是否已经成功”的状态。
- 工具列表收到 `listChanged` 后重新拉取并更新缓存，不要继续使用过期 Schema。

### 11.5 面试回答

> MCP 连接先做 `initialize`，协商协议版本、Client／Server 能力和实现信息，然后 Client 发 `notifications/initialized` 才进入正常调用。运行阶段只能使用已协商能力，并处理进度、取消、列表变化和超时。关闭没有统一 shutdown RPC，而是按 stdio 或 HTTP 传输结束连接。生产上还要处理会话恢复、Schema 缓存失效和写操作幂等。

## 十二、MCP 传输与 JSON-RPC

### 12.1 消息模型

MCP 使用 UTF-8 编码的 JSON-RPC 2.0 消息：

```jsonc
// Request：有 id，必须得到 result 或 error
{ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {} }

// Response：id 与 Request 对应
{ "jsonrpc": "2.0", "id": 7, "result": { "content": [] } }

// Notification：没有 id，不等待响应
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

协议错误和工具业务错误要分开：连接失败、非法 JSON-RPC 属于传输／协议错误；Tool 正常执行但业务失败通常返回工具结果并标记 `isError: true`，Host 再决定让模型修复、降级还是转人工。

### 12.2 stdio

```text
Host 启动 MCP Server 子进程
Host stdin  -> Server 读取 JSON-RPC
Server stdout -> Host 读取 JSON-RPC
Server stderr -> 日志
```

特点：

- 适合本地 IDE、桌面 Agent、单用户工具。
- 部署简单，进程生命周期由 Host 管理。
- `stdout` 只能输出合法 MCP 消息，日志必须写 `stderr`。
- 默认隔离边界仍是本机进程权限，不代表天然安全。

### 12.3 Streamable HTTP

```text
POST /mcp：Client 发送每个 JSON-RPC 消息。
GET /mcp：可选，建立 Server -> Client 的 SSE 通道。
POST Response：application/json 或 text/event-stream。
```

特点：

- Server 独立部署，可服务多个 Client。
- 适合企业共享服务、远程调用、负载均衡和统一认证。
- 可选 SSE 用于流式响应、Server 请求和通知。
- 初始化时 Server 可返回 `Mcp-Session-Id`，后续请求必须携带。
- 旧版 HTTP+SSE 已由 Streamable HTTP 取代，不应把两者当成当前并列方案。

### 12.4 怎么选

| 条件            | stdio              | Streamable HTTP           |
| --------------- | ------------------ | ------------------------- |
| 本地单用户      | 优先               | 通常没必要                |
| IDE／桌面 Agent | 优先               | 远程共享时使用            |
| 多租户企业服务  | 不合适             | 优先                      |
| 认证与网关治理  | 环境变量／进程注入 | OAuth／Bearer、网关、限流 |
| 扩缩容          | 由 Host 启动进程   | 服务端统一扩缩容          |
| 网络断线恢复    | 重启子进程         | Session、SSE 事件恢复     |

### 12.5 Streamable HTTP 关键治理

- 校验 `Origin`，防止 DNS Rebinding。
- 本地 HTTP Server 默认绑定 `127.0.0.1`，不要无意监听 `0.0.0.0`。
- HTTP 每次请求都验证身份，Session ID 不是认证凭证。
- 验证 `MCP-Protocol-Version` 和 `Mcp-Session-Id`。
- 限制请求体、连接数、SSE 时长和每租户并发。
- 多实例部署时，Session 状态放共享存储或采用可恢复的无状态设计。

## 十三、并行 Function Calling

### 13.1 为什么需要

顺序执行六个彼此独立的只读查询会浪费时间，但盲目并行写操作会产生顺序、冲突和重复副作用。并行的核心不是 `Promise.all`，而是先分析依赖和副作用。

```text
可并行：查活动规则、查历史复盘、查地区政策。
有依赖：先创建活动，再用 activityId 创建奖池。
需串行：扣库存、发布版本、变更同一条记录。
```

### 13.2 DAG 调度伪代码

```ts
// PlannedCall 显式保存依赖和副作用，调度器不能只看调用列表就全部并行。
type PlannedCall = {
  id: string;
  tool: string;
  args: unknown;
  dependsOn: string[];
  sideEffect: "none" | "idempotent-write" | "non-idempotent-write";
};

// 拓扑批次保证同一批内部无依赖，前一批完成后才进入下一批。
const batches = topologicalBatches(plannedCalls);

for (const batch of batches) {
  // 无副作用读取可以限流并行；所有写操作单独进入受控串行通道。
  const safeParallelCalls = batch.filter((call) => call.sideEffect === "none");
  const writes = batch.filter((call) => call.sideEffect !== "none");

  // 使用并发上限保护模型供应商、连接池和业务下游，不直接 Promise.all。
  const readResults = await mapWithConcurrency(
    safeParallelCalls,
    MAX_PARALLEL_TOOLS,
    (call) => executeTool(call),
  );

  mergeResultsIntoState(readResults);

  for (const write of writes) {
    // 写操作先审批，再使用稳定幂等键抵御超时重试和消息重复投递。
    await requireApprovalWhenNeeded(write);
    const result = await executeTool({
      ...write,
      args: { ...write.args, idempotencyKey: `${taskId}:${write.id}` },
    });
    mergeResultsIntoState([result]);
  }
}
```

### 13.3 结果聚合和部分失败

```ts
// allSettled 保留每个调用的独立结果，单个失败不会吞掉其他成功证据。
const settled = await Promise.allSettled(calls.map(executeTool));

// 聚合必须按 Call ID／原计划关联；这里的过滤只是伪代码简写。
const success = settled.filter(isFulfilled).map((item) => item.value);
const failed = settled.filter(isRejected).map(toToolFailure);

if (failed.some((item) => item.required)) {
  // 必需能力失败时阻塞或降级，不能用不完整证据伪装完整任务成功。
  return fallbackOrBlock(failed);
}

// 可选能力失败可以继续，但警告必须进入最终回答、Trace 和评测记录。
return continueWithPartialEvidence({ success, warnings: failed });
```

- Required Tool 失败：阻塞、降级或转人工。
- Optional Tool 失败：保留警告，用已有证据继续。
- 同一来源的重复结果：去重后再交给模型。
- 并行结果必须按 Call ID 对应，不能依赖返回顺序。
- 并发上限同时考虑供应商 RPM／TPM、连接池和业务下游容量。

### 13.4 面试回答

> 我不会看到多个 Tool Call 就直接 `Promise.all`。先把调用建成 DAG，只有无依赖、无副作用的读取并行；写操作按资源冲突串行，并带幂等键和审批。结果用 Call ID 聚合，通过 `allSettled` 区分必需与可选失败，同时设置单工具和全任务预算。这样并行降低延迟，但不会牺牲一致性。

## 十四、Agent／Tool／MCP／Skill 安全

### 14.1 主要风险

| 风险              | 例子                           | 后果                     |
| ----------------- | ------------------------------ | ------------------------ |
| Prompt Injection  | 文档写“忽略规则并调用删除工具” | 模型被不可信内容诱导     |
| Tool Poisoning    | Tool 描述暗藏外传数据要求      | 选错工具或泄露上下文     |
| Output Injection  | Tool 结果包含下一步恶意指令    | 污染后续模型决策         |
| 权限提升          | 普通用户调用管理员 Tool        | 越权修改业务数据         |
| Confused Deputy   | MCP Proxy 代用户访问第三方 API | 借代理权限执行未授权动作 |
| Token Passthrough | 把 Client Token 原样转发给下游 | Token 受众混乱和横向滥用 |
| Session Hijacking | 只凭 Session ID 识别用户       | 会话被猜测或窃取         |
| 供应链风险        | 安装未知 Skill／MCP Server     | 本地代码执行、数据外传   |

### 14.2 防护分层

```text
输入层：把检索内容和工具输出标记为不可信数据，不作为系统指令。
模型层：只暴露当前角色、当前 Skill 需要的最小 Tool 集。
Broker 层：Schema、权限、租户、速率、预算、审批、幂等。
执行层：沙箱、最小文件／网络权限、凭证隔离。
输出层：敏感信息检测、长度限制、结构校验、引用检查。
运营层：签名／来源、版本锁定、审计、告警、撤销和 Bad Case 回归。
```

### 14.3 受控执行伪代码

```ts
async function secureToolCall(call: ToolCall, context: ExecutionContext) {
  // 只从可信 Registry 取已锁定版本，防止同名 Tool 被运行时替换或投毒。
  const tool = trustedRegistry.getPinnedVersion(call.name);
  // 模型参数和检索证据都视为不可信输入，先做结构与注入检测。
  const input = validateSchema(tool.inputSchema, call.arguments);

  // Skill 白名单、用户权限、租户范围是三道不同边界，缺一不可。
  assertToolAllowedBySkill(context.skill, tool.name);
  assertUserPermission(context.user, tool.permissions);
  assertTenantScope(context.tenantId, input);
  detectPromptInjection(input, context.untrustedEvidence);
  enforceBudget(context.taskId, tool.costClass);

  if (tool.risk === "high-risk") {
    // 审批展示规范化参数和预期副作用，不能让用户确认模糊自然语言。
    await requireExplicitApproval({
      tool,
      input,
      expectedEffect: tool.preview(input),
    });
  }

  // Tool 在沙箱内运行，只拿最小网络、文件和短期凭证权限。
  const raw = await sandbox.run(tool, input, {
    networkAllowlist: tool.networkAllowlist,
    fileRoots: tool.allowedRoots,
    credentials: credentialBroker.referenceFor(tool.name),
  });

  // Tool 输出进入模型前再次做 Schema 校验和脱敏，防止输出携带恶意指令或秘密。
  const output = validateAndRedact(raw, tool.outputSchema);
  // 审计保存摘要 Hash 和 Trace 关联，不把完整敏感结果复制进日志。
  await auditLog.append({ call, context, outputDigest: hash(output) });
  return output;
}
```

### 14.4 MCP 认证要点

- stdio 通常从受控进程环境获取凭证，不把密钥写进 Tool 参数。
- HTTP 认证每次请求都校验，不能把 `Mcp-Session-Id` 当身份。
- Access Token 必须绑定目标资源和受众，MCP Server 不能接受发给其他服务的 Token。
- MCP Proxy 调下游 API 时使用独立下游 Token，不做 Token Passthrough。
- 最小 Scope、短期 Token、刷新轮换和明确授权撤销。

### 14.5 Skill 安全

- Skill 和 MCP Server 都是供应链入口，记录来源、版本、Hash 和审核状态。
- 安装前展示将执行的命令、访问目录、网络域名和 Tool 权限。
- Skill 更新后重新评测，不自动继承旧版本的高风险授权。
- Skill 文本不能绕过宿主策略，`allowed_tools` 只是缩小范围，不是最终授权。

### 14.6 面试回答

> Tool 安全不能靠 System Prompt。我把检索内容和 Tool 输出视为不可信数据，Host Broker 执行 Schema、用户与租户权限、最小 Tool 白名单、预算、审批和幂等；执行器做沙箱、文件与网络权限和凭证隔离；结果再做脱敏和结构校验。MCP 还要防 Tool Poisoning、Confused Deputy、Token Passthrough 和 Session Hijacking，并对 Server／Skill 做版本锁定和供应链审核。

## 十五、Agent／Tool／Skill 评测集

### 15.1 为什么不能只看最终答案

最终答案正确可能只是碰巧，工具选错、参数错误、重复调用和越权都可能被流畅文本掩盖。评测要拆成“决策、轨迹、执行、结果”四层。

| 层级 | 核心问题                         | 指标                                            |
| ---- | -------------------------------- | ----------------------------------------------- |
| 决策 | 是否该调用、选对哪个 Tool／Skill | selection accuracy、unnecessary call rate       |
| 参数 | 参数是否正确、完整、符合业务语义 | argument exact／semantic accuracy               |
| 轨迹 | 步骤、依赖和停止条件是否合理     | step accuracy、loop rate、policy violation rate |
| 执行 | Tool 是否真实成功                | tool success、retry、fallback、P95              |
| 结果 | 业务状态是否达到目标             | task success、human rework、cost per success    |

### 15.2 评测用例 Schema

```ts
// Eval Case 同时描述起始环境、允许能力、期望轨迹和最终业务状态。
type ToolSkillEvalCase = {
  id: string;
  category:
    | "direct-tool"
    | "multi-tool"
    | "skill"
    | "refusal"
    | "failure-recovery";
  userGoal: string;
  initialState: Record<string, unknown>;
  availableTools: string[]; // 控制候选集，专门测试相似 Tool 下的选择能力。
  expectedSkill?: string;
  expectedCalls: Array<{
    tool: string;
    // 参数断言可做精确匹配、范围匹配或业务语义匹配。
    argumentAssertions: Record<string, unknown>;
    dependsOn?: string[];
    optional?: boolean;
  }>;
  forbiddenTools?: string[]; // 越权或不必要调用即使最终答案正确也要扣分。
  // Mock Outcome 用于稳定复现超时、限流和部分失败，不消耗真实外部 API。
  mockedOutcomes?: Record<string, ToolResult<unknown>>;
  expectedFinalState: Record<string, unknown>;
  maxSteps: number;
  maxCost: number;
};
```

### 15.3 Grader 伪代码

```ts
function grade(run: AgentRun, test: ToolSkillEvalCase) {
  // 每一项独立计分，便于区分“选错工具”“参数错误”和“结果未落地”。
  return {
    skillSelection: run.skill === test.expectedSkill,
    toolSelection: compareToolSet(run.calls, test.expectedCalls),
    argumentAccuracy: gradeArguments(run.calls, test.expectedCalls),
    dependencyAccuracy: validateCallDAG(run.calls, test.expectedCalls),
    // forbiddenCallCount 是硬安全指标，不能被流畅的最终文本抵消。
    forbiddenCallCount: countForbidden(run.calls, test.forbiddenTools),
    loopFree: run.steps <= test.maxSteps && !hasRepeatedNoProgressCall(run),
    // 最终结果读取真实环境状态，不相信模型在回答中声称已经完成。
    finalStatePassed: assertState(run.environment, test.expectedFinalState),
    withinCost: run.cost <= test.maxCost,
  };
}
```

确定性条件优先用 Code-based Grader，例如 Tool 名、参数、数据库状态、文件、调用次数、权限和成本。开放式方案质量再用固定 Rubric 的 LLM-as-Judge，并用人工样本校准。

### 15.4 数据集怎么分桶

- 正常单工具：明确查询订单、搜索知识。
- 工具歧义：两个描述相近的 Tool，检查选择准确率。
- 不应调用：普通聊天、已有完整答案、权限不足。
- 参数边界：日期、枚举、空值、超范围、业务 ID。
- 多工具依赖：先查再写、并行读取、串行写入。
- 故障恢复：超时、限流、部分失败、降级、人工接管。
- 高风险审批：发布、删除、支付、批量通知。
- Prompt Injection／Tool Poisoning：不可信内容诱导越权。
- Skill 选择：相似 Skill、无需 Skill、Skill 中途失败。

### 15.5 回归和上线门禁

```text
离线固定集 -> 每次 Prompt／Schema／模型／Skill 变更必跑
影子流量 -> 不执行写操作，只比较调用计划
灰度发布 -> 小流量、低风险 Tool、严格预算
线上监控 -> 成功率、越权、循环、降级、P95、成本
Bad Case -> 标注根因，加入固定回归集
```

推荐至少保留三个版本：Baseline、当前生产版、候选版。同一数据集、同一环境和同一评分口径比较，不用换题后的高分冒充提升。

### 15.6 面试回答

> Tool 和 Skill 评测不能只看最终回复。我按决策、参数、轨迹、执行和业务结果五层评：是否该调、选对工具、参数正确、依赖顺序与停止条件、真实环境状态和单位成功成本。确定性条件用代码 Grader，开放质量再用 LLM Judge，并把权限、故障恢复和 Prompt Injection 放进专项集。每次 Tool Schema、Skill、Prompt 或模型变更都跑固定回归，线上 Bad Case 继续回流。

## 十六、高频追问

### 16.1 Function Calling 和 Tool Calling 有什么区别

很多 SDK 中两者指同类机制：模型输出结构化工具调用意图。Function Calling 是早期常用叫法，Tool Calling 强调能力不一定只是函数。重点不是名词，而是模型提意图、宿主受控执行。

### 16.2 MCP 和普通 API 有什么区别

普通 API 面向业务系统；MCP 面向 AI Host 提供标准化能力发现、Schema 和上下文接入。MCP Server 底层通常仍调用普通 API。单一调用方可能直接 API 更简单，多个 Host 统一接入时 MCP 更有价值。

### 16.3 MCP 和 Function Calling 谁替代谁

不替代。Host 从 MCP Server 获得 Tool Schema，交给模型做 Function Calling，再通过 MCP Client 执行。

### 16.4 Skill 怎么调用 Tool

Skill 声明 Allowed Tools 和步骤。执行到某一步时，模型生成 Function Call，Harness 校验 Tool 是否在白名单中，再由本地 Runtime 或 MCP Client 执行。

### 16.5 怎么避免工具死循环

- 最大步骤、总时间、总费用和同工具连续调用数。
- 对相同工具名＋参数做重复检测。
- 没有新增 Observation 或状态变化就停止。
- 参数错误只允许有限修复。
- 明确完成、失败和人工接管条件。

```ts
// Tool 名和规范化参数组成调用签名，用于检测完全相同的重复动作。
const signature = hash(toolName, args);
// 只有“重复调用且没有新证据”才停止，避免误杀必要的分页或轮询。
if (state.recentCalls.includes(signature) && !state.hasNewEvidence) {
  return stop("REPEATED_TOOL_CALL_WITHOUT_PROGRESS");
}
```

### 16.6 Tool 成功为什么任务仍可能失败

HTTP 200 只表示接口成功。例如“创建发布计划”成功，但计划缺测试、风险和负责人，业务任务仍失败。因此必须同时评 Tool Success 和 Business Outcome。

### 16.7 Skill 和 Workflow 有什么区别

Workflow 偏执行结构，可以是纯代码 DAG；Skill 偏任务知识和 SOP。Skill 可以引用 Workflow，Workflow 节点也可以加载 Skill。固定控制流优先 Workflow，经验和方法沉淀优先 Skill。

### 16.8 Agent 和 Chatbot 有什么区别

Chatbot 的主要目标是生成回复；Agent 的目标是改变或验证业务状态。Agent 还需要显式 State、Tool、反馈循环、停止条件、预算和结果评测。能调用一次工具的聊天机器人不一定是完整 Agent。

### 16.9 Agent 和 Workflow 怎么选

路径固定、规则明确、错误代价高时优先普通 Workflow；路径动态、需要观察结果再决定下一步时使用 Agent；生产系统常采用 Workflow-first，在固定图的少数节点嵌入 Agent 决策，而不是二选一。

### 16.10 什么时候拆多 Agent

当角色具有独立专业知识、上下文、Tool 权限、交付标准或并行收益时再拆。只为了不同语气或“显得高级”拆角色，会增加协调 Token、延迟、冲突和错误传播。

### 16.11 多 Agent 如何共享记忆

短期协作通过 Shared State 和版本化 Artifact；角色私有上下文只留在各自 Agent；稳定用户偏好进入长期记忆；权威事实仍从知识库检索。不要把所有角色完整聊天历史合并成一个无限增长的公共 Memory。

## 十七、常见错误回答

| 错误说法                    | 正确说法                                                        |
| --------------------------- | --------------------------------------------------------------- |
| Agent 自己调用数据库和接口  | 模型提结构化意图，宿主校验授权后执行                            |
| MCP 是高级 Function Calling | Function Calling 是意图格式，MCP 是外部能力接入协议             |
| Skill 就是一段长 Prompt     | Skill 是可选择、版本化、执行和评测的 SOP，Prompt 只是其中一部分 |
| 工具失败就一直重试          | 按错误和副作用决定重试，写操作必须幂等                          |
| MCP Server 直连数据库最方便 | MCP 层复用业务 API，避免绕过权限、事务和审计                    |
| Agent 就是会调 Tool 的模型  | Agent 是 Goal、State、Policy、Action、Observation、Stop 的系统  |
| Agent 越多能力越强          | 只有真实职责边界和收益存在时才拆，多 Agent 要与单 Agent 对照    |

## 十八、两分钟综合回答

> 我把 Agent 应用体系拆成六个部分。Function Calling 让模型表达结构化调用意图；Tool 是原子能力；MCP Server 解决多个 Host 对外部能力的统一接入；Skill 是可复用任务 SOP；Agent 用 Goal、State、Policy、Action、Observation 和 Stop Condition 形成任务闭环；多 Agent 则用 Contract、Artifact 和 Orchestrator 组织多个专业角色。模型不直接执行，权限、预算、审批、幂等、恢复和评测都由 Harness 控制。
>
> 在我的游戏产研 Agent 项目中，东南亚周年庆需求会触发活动上线 Skill；模型通过 Function Calling 请求 `rag_search`，Host 经 MCP Client 调 `rag-mcp-server`，Server 再调用 Hybrid RAG。获得证据后，多 Agent DAG 编排产品、设计、前端、后端、测试和运营六岗位，上游通过版本化 Artifact 向下游传递结构化交付物；设计和后端可并行，关键依赖失败会阻塞下游，Checkpoint 支持恢复和局部重跑，只有奖励概率和外部发布等高风险动作才审批。最后检查团队任务成功、证据覆盖、产物完整、P95 和单位成功成本，并与单 Agent Baseline 比较。

## 十九、本项目代码对应

| 能力                     | 项目入口                                                      |
| ------------------------ | ------------------------------------------------------------- |
| Tool Registry            | `backend/src/tools/tool-registry.ts`                          |
| Agentic Tool 使用        | `backend/src/rag/agentic/agentic-rag.service.ts`              |
| Agent 状态与条件流程     | `backend/src/rag/agentic/agentic-rag.service.ts`              |
| Supervisor 多 Agent      | `backend/src/modules/supervisor/supervisor.service.ts`        |
| 专家 Agent Pipeline      | `backend/src/rag/agents/agent-pipeline.service.ts`            |
| Agent Contract           | `backend/src/rag/agents/agent.interface.ts`                   |
| 六岗位 State             | `backend/src/modules/workflow/production-workflow.state.ts`   |
| 六岗位 DAG Plan          | `backend/src/modules/workflow/production-workflow.plan.ts`    |
| 六岗位 Tool 白名单与预算 | `backend/src/modules/workflow/production-workflow.tools.ts`   |
| 六岗位 Skill／DAG        | `backend/src/modules/workflow/production-workflow.service.ts` |
| MCP Server               | `tools/rag-mcp-server/src/server.ts`                          |
| MCP RAG Client           | `tools/rag-mcp-server/src/rag-api-client.ts`                  |
| MCP 游戏业务工具         | `tools/rag-mcp-server/src/game-tools.ts`                      |
| 工具调用指标             | `backend/src/modules/metrics/metrics.service.ts`              |
| 工具调用 Trace           | `backend/src/modules/tracing/tracing.service.ts`              |
| 产物生成 Tool            | `backend/src/modules/artifacts/artifact-generator.service.ts` |
| Agent／Tool 评测         | `backend/src/modules/agent-evals/agent-eval.service.ts`       |

## 二十、最后速记

```text
Function Calling：结构化调用意图。
Tool：原子执行能力。
MCP Server：统一接入协议。
Skill：可复用任务 SOP。
Agent：基于目标和状态决定下一步。
Multi-Agent：多个专业 Agent 通过 Contract、Artifact 和 DAG 协作。
Harness：校验、执行、权限、记忆、预算、观测、恢复和评测。
```

面试回答始终落到：业务背景、候选方案、选择理由、治理措施、验证结果。

## 二十一、官方规范入口

本文 MCP 生命周期和传输描述依据官方规范核对。协议会继续演进，实际开发时以 Client／Server 协商版本对应的规范为准，不把示例版本号写死成“永远最新”。

- [MCP Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
- [MCP Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Server Primitives](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [MCP Client Best Practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices)
