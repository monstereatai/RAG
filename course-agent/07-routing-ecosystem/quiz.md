# 第 7 节自测 · 你学会了吗？

> 合上讲义独立完成，再对照底部答案。**通过标准：满分 12 拿 ≥10 分 + Lab 完成（MCP server 接入 + 路由与技能验证）。**

## 一、判断题（每题 1 分）

1. Supervisor 对每个请求都调用 LLM 做领域分类。
2. Skills 与 RAG 知识库的定位相同——都是事实知识的存储。
3. MCP server 拉取的工具在本项目中仍需经 Tool Registry 的四道闸才能执行。

## 二、选择题（每题 1 分）

4. `DomainConfig` 不包含以下哪个字段？
   - A. keywords（关键词列表）
   - B. description（领域中文描述）
   - C. budget（领域 token 预算）

5. Skills 匹配的技术路径是？
   - A. 关键词全文检索
   - B. OpenAIEmbeddings 语义相似度 + 按需注入
   - C. 全量注入所有技能

6. `smoke:mcp` 冒烟脚本验证的是？
   - A. 工具的输出质量
   - B. MCP server 连通性 + 工具列表拉取 + 一次工具调用
   - C. Tool Registry 的注册完整性

## 三、简答题（每题 2 分）

7. Supervisor 的"关键词先行、LLM 兜底"两级路由，与 RAG 课程里的哪个设计是同一思想？这个思想的普适原则是什么？
8. MCP 工具条目的 fallback 声明"MCP server 未启用或失败时禁用对应工具，不影响核心 RAG"——这体现了外部依赖的什么设计原则？

## 四、代码审查题（2 分）

9. 同学的 MCP 接入代码：

```ts
async function bindTools(graph) {
  const client = new MultiServerMCPClient({ servers: yamlConfig });
  const mcpTools = await client.getTools();          // 拉全部外部工具
  for (const tool of mcpTools) {
    graph.bindTool(tool);                             // 直接绑给模型
  }
}
```

对照本节讲义，指出至少 3 个问题并给出正确做法。

---

## 参考答案（先做完再看）

1. **错**。关键词快速命中是零成本确定性路径，LLM 只在不确定时兜底（§3.1）。
2. **错**。Skills 是"怎么干"的**过程性知识**（操作手册），RAG 是"是什么"的事实知识——解耦的原因：塞 System Prompt 会污染所有对话（§3.2）。
3. **对**。Registry 有 `source: 'mcp'` 条目，四道闸照过（§3.4——本节灵魂）。
4. **C**。name / description / keywords / pipeline（§3.1）。
5. **B**。语义匹配命中才注入（§3.2）。
6. **B**。连通性冒烟：连接 → 拉列表 → 调用一次（§3.3）。
7. 与 RAG 第 5 节"直答捷径先于全量检索"、直答只查 PG 不碰 Milvus 同思想；普适原则：**便宜的确定性路径先行，昂贵的语义路径兜底**——路由如此、检索如此、分类也如此。每省一次 LLM 调用，延迟与成本同时受益。
8. 故障半径预声明：外部依赖（MCP server 是你控制力最弱的组件）挂掉时，**影响被约束在"该生态工具禁用"**，核心链路（RAG 问答）照常——这不是代码行为，是注册时被迫想清楚并写下的降级契约（第 2 节 fallback 字段的外部依赖版）。
9. ① `getTools()` 全量直通模型：外部工具对模型完全可见，含未审计的高危工具——正确做法：每个工具先在 Tool Registry 注册（source: 'mcp'，补 risk/timeout/fallback），执行走 ToolExecutionService 四道闸；② 无连通性验证：server 挂了才发现——先跑 smoke:mcp / 启动健康检查；③ 无降级声明：MCP 失败时链路行为未定义——注册 fallback（禁用对应工具不影响核心链路）；④ 无 roles/modes 限制：任何场景都能调外部工具——按需收紧 modes 与 roles。

**计分**：判断/选择每题 1 分，简答/代码题每题 2 分，满分 12。
**通过标准**：≥10 分 + Lab 完成。未达标 → 重读 §3.4 与坑点 1，隔天重做。
