# 第 7 节讲义 · 工程化封装：隔离、缓存、长期记忆

> 课程：《从零手撕企业级 RAG》第 7 节 · 把 demo 变成多租户产品
> 源码：[jwt-auth.guard.ts](../../backend/src/common/guards/jwt-auth.guard.ts) · [memory.service.ts](../../backend/src/modules/memory/memory.service.ts) · [mem0.provider.ts](../../backend/src/providers/mem0/mem0.provider.ts) · [short-term-memory.service.ts](../../backend/src/modules/memory/short-term-memory.service.ts) · [conversation-embedding.service.ts](../../backend/src/modules/chat/conversation-embedding.service.ts)
> 前置：第 3 课（Milvus user_id）、第 4 课（BM25 条目元数据）埋的伏笔在此收线

## 一、痛点引出

Demo 和产品之间隔着三道墙：**没有认证**——谁都能调你的 API；**没有隔离**——A 公司的检索结果里混着 B 公司的文档；**没有记忆**——每轮对话都是失忆重启。前两道墙是安全事故，第三道墙是体验缺陷。本节把这三道墙用真实代码砌完。

## 二、三道墙总览

```
认证墙：JwtAuthGuard → request.user → @CurrentUser() 装饰器
隔离墙：userId 贯穿四层 —— PostgreSQL / Redis / Milvus+Mem0 / BM25
记忆墙：三层 —— Redis 短期窗口 / Mem0 长期（user+session）/ 对话历史向量化
```

## 三、代码拆解

### 3.1 认证入口：guard + 装饰器（jwt-auth.guard.ts L20-52 / L56-75）

`JwtAuthGuard` 校验 JWT 后把 payload 注入 `request.user`；Controller 用 `@CurrentUser()` 装饰器取出。注意 `extractToken`（L56-75）支持 **Authorization header 或 query 参数**两种来源——后者不是图省事：浏览器原生 `EventSource` 无法自定义请求头，SSE 场景必须有替代通道。**教学引导语**：每个"奇怪的设计"背后 usually 有一个被平台限制逼出来的真实约束。

### 3.2 隔离墙：userId 贯穿四层（泄漏矩阵）

| 层 | 代码点 | 漏了会怎样 |
|---|---|---|
| PostgreSQL | 实体 userId 列 + 查询过滤 | API 直查拿到他人文档元数据 |
| Redis | `stm:{conversationId}:turns` / `:summary`（会话归属用户） | 上下文串台 |
| Milvus | `expr: user_id == "${userId}"`（[第 3 课](../03-embedding/README.md)） | **向量检索返回他人内容（语义层泄露，最难察觉）** |
| Mem0 | 搜索 `AND: [{ user_id }, { run_id }]`（mem0.provider.ts L89-128） | 长期记忆跨用户注入 |
| BM25 | 持久化条目 userId 字段过滤（[第 4 课](../04-bm25/README.md)） | 关键词兜底通道裸奔 |

**为什么四层而不是只在 API 层判断一次**：纵深防御。API 层漏判、内部服务调用、未来新增的检索通道，都可能绕过单一防线；数据层过滤是最后防线——每一层都不信任上一层。

### 3.3 记忆墙：三层记忆（chat.service.ts L64-107 并发加载）

- **短期**（short-term-memory.service.ts）：Redis sorted set 按 `stm:{conversationId}:turns` 存最近 N 轮 + `:summary` 滚动摘要，带 TTL（L153-179）——缓存式恢复，过期即忘。
- **长期**（memory.service.ts）：`searchMemory`（L93-129）并发检索 Mem0 的 **user 层 + session 层**；`classifyAndPersist`（L140-189）先让 **LLM 分类**这段对话该记什么（用户偏好→user 层 / 会话上下文→session 层），再分层写入——**不是什么都记**，信噪比是记忆系统的生命线。
- **历史向量化**（conversation-embedding.service.ts）：QA 对嵌入 Milvus，写入带 `user_id`（L65-111）、检索按用户过滤（L121-157）——历史对话成为**可检索证据**，"我上次问过的那个方案"能被召回。

### 3.4 记忆注入的卫生

三源（短期/长期/历史）并发加载后注入上下文，但长期记忆经过**分类过滤**（只注入高相关类别），避免几周前的无关偏好污染当前回答——记忆是资产也是污染源。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：四层漏一层——最易漏在新通道

- **现象**：渗透测试时用户 B 搜到了用户 A 上传的文档片段；主链路正常，只有某些查询泄露。
- **根因**：新增检索通道（如新集合、BM25 兜底、debug 接口）时忘了带 userId 过滤——Milvus 主查询大家都会记得，**兜底路径和旁路最容易被遗漏**。
- **排查三步**：A/B 双账号 + A 上传私密标记文档 → B 用正常问答、直接文档 API、底层检索接口三路探测 → 任何一路命中即定位到具体层。这个渗透测试就是本节 Lab。

### 坑点 2：记忆注入污染上下文

- **现象**：回答莫名提及用户几周前的偏好（"根据你之前的偏好蓝色…"），而当前问题与之无关；甚至被旧记忆带偏结论。
- **根因**：记忆系统"什么都记、什么都注入"——无分类写入 + 无相关度门槛。
- **排查/预防**：对照本实现——写入前 LLM 分类（该不该记、记到哪层）+ 注入时相关度过滤 + 注入预算（记忆占用上下文的配额）。

## 五、讲师口播稿（约 300 字）

> 前六节课我们造了一台性能不错的机器，但它现在是个裸奔的状态：没有门锁、没有房间、也没有记性。今天补上三样东西。第一样，门锁——JWT 认证。有个细节很有意思：我们的 token 支持从 query 参数取，看起来不安全，为什么留着？因为浏览器的 EventSource 发不了自定义请求头，流式接口就活不了——工程里很多"不优雅"，是被平台限制逼出来的坦诚。第二样，房间——多租户隔离。A 公司的知识库里搜出 B 公司的合同，这在企业场景不是 bug，是事故。我要你们记住一个数字：四层。数据库、Redis、向量库、BM25，每一层都要带 userId，漏一层就是裸奔——而最容易被漏掉的，恰恰是你新加的那个检索通道。第三样，记性——三层记忆：短期窗口、长期偏好、历史向量化。但记忆是资产也是污染源，什么都记的系统，最后会把用户几周前的无关偏好塞进每个回答。学完这节，你的 RAG 才真正从 demo 变成产品。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 7 节](../README.md)）：A/B 双账号渗透测试四层隔离验证 → 长期记忆开/关对比同一"我之前说过"问题
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
