# 第 7 节自测 · 你学会了吗？

> 合上讲义独立完成，再对照底部答案。**通过标准：满分 12 拿 ≥10 分 + Lab 完成（四层渗透测试记录 + 记忆对比）。**

## 一、判断题（每题 1 分）

1. Redis 短期记忆的隔离粒度是 userId，key 形如 `stm:{userId}:turns`。
2. `extractToken` 支持 query 参数传 token，是因为浏览器原生 EventSource 无法自定义请求头。
3. 对话历史向量化后，历史 QA 也成为带 user_id 过滤的可检索证据。

## 二、选择题（每题 1 分）

4. Mem0 长期记忆检索时携带 runId，过滤条件的构造方式是？
   - A. 只按 run_id 过滤
   - B. `AND: [{ user_id }, { run_id }]` 双条件
   - C. 先 user 后 run 两次串行查询

5. `classifyAndPersist` 在写入长期记忆前让 LLM 先做分类，主要目的是？
   - A. 给记忆打标签方便管理后台展示
   - B. 决定这段内容该不该记、记到 user 层还是 session 层——控制信噪比
   - C. 压缩记忆节省存储

6. 四层隔离里**最难被察觉**的泄露发生在哪层？
   - A. PostgreSQL（结构化查询，容易被审计发现）
   - B. Milvus 向量检索（语义层返回他人内容，没有明确报错）
   - C. Redis（key 命名规律明显）

## 三、简答题（每题 2 分）

7. 为什么隔离要做四层纵深，而不是只在 API 层判一次 userId？列出至少两类"绕过单一防线"的真实路径。
8. 记忆注入为什么要做"分类过滤 + 相关度门槛"，而不是把搜到的记忆全部塞进上下文？

## 四、代码审查题（2 分）

9. 同学的 Controller 实现：

```ts
@Get('search')
async search(@Query('q') q: string, @Query('userId') userId: string) {
  return this.karpathyRag.retrieve(q, { userId });  // 前端把 userId 拼在 query string 里
}
```

指出致命问题并给出正确写法（用本节讲过的组件）。

---

## 参考答案（先做完再看）

1. **错**。粒度是 conversationId（`stm:{conversationId}:turns`），会话由 userId 创建/归属——隔离链条是"用户→会话→key"，而非直接用 userId 做 key（§3.3）。
2. **对**。SSE 流式接口的平台约束（§3.1）。
3. **对**。写入带 user_id、检索按用户过滤（§3.3 历史向量化）。
4. **B**。AND 双条件（mem0.provider.ts L89-128，§3.2 矩阵）。
5. **B**。信噪比是记忆系统的生命线（§3.3、坑点 2）。
6. **B**。语义层泄露：检索"正常返回"，无报错无日志异常，只有渗透测试能发现（§3.2 矩阵、坑点 1）。
8. 记忆是资产也是污染源：无关记忆（几周前的偏好）注入会带偏当前回答、挤占上下文预算、制造"莫名提及"的诡异体验；全量注入还放大隐私暴露面。分类决定"值得记的才记"，相关度门槛决定"相关的才注入"。
7. 纵深防御：① API 层漏判（代码 review 疏漏/新接口忘加 guard）时数据层过滤仍兜底；② 内部调用（定时任务、服务间调用、admin 工具）不走 HTTP guard，直接打到数据层；③ 新增检索通道（BM25 兜底、新集合、debug 接口）不在原 API 路径上，单点防线根本管不到。每层不信任上一层。
9. 致命问题：**身份来自客户端可控的 query 参数**——任何人不带 token 就能冒充任意 userId 检索他人数据，认证墙完全失效。正确写法：路由挂 `JwtAuthGuard`（或全局 guard），身份从校验过的 JWT payload 取——

```ts
@UseGuards(JwtAuthGuard)
@Get('search')
async search(@Query('q') q: string, @CurrentUser() user: JwtPayload) {
  return this.karpathyRag.retrieve(q, { userId: user.userId }); // 身份只信服务端校验结果
}
```

**计分**：判断/选择每题 1 分，简答/代码题每题 2 分，满分 12。
**通过标准**：≥10 分 + Lab 完成。未达标 → 重读 §3.2 泄漏矩阵与坑点 1，隔天重做。
