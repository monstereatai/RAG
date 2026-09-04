# 第 3 节讲义 · 工具治理 II：幂等、审计与四态故障语义

> 课程：《从零手撕企业级 AI Agent》第 3 节 · 工具治理 II
> 源码：[tool-execution.service.ts](../../backend/src/tools/tool-execution.service.ts)（本讲义主角，全 140 行） · [agent-runtime-events.service.ts](../../backend/src/modules/agent-runtime-events/agent-runtime-events.service.ts)
> 先修：第 2 节 Tool Registry 与执行策略

## 一、痛点引出

LLM 天生会重试：网络抖动重试、框架超时重试、Agent 循环里"再试一次"。对一个只读工具，重试无害；对一个**写工具**（发邮件、下单、写库），重复执行 = 事故。更阴险的是第三种情况：请求发出去了、结果没回来——**你不知道它到底执行了没有**，此时盲目重试就是赌博。本节讲执行外壳如何把"重复""未知""失败"变成机器可读的四态语义。

## 二、整体架构：execute() 执行外壳全景（L52-122)

```
callId 生成 → policy.decide（第 2 节四道闸）
  → tool.call 审计事件
  → [审批] requiresApproval → approval.asked → 批准? → approval.decided → 未批 → blocked
  → [幂等] sideEffect → 幂等键 → Redis 三态检查（completed / running / 无）
  → execute() 业务执行 → 成功: completed:结果 落 Redis → success
                      → 异常: unknown 落 Redis → failed
  → finish(): 统一结果事件 + durationMs
```

## 三、代码拆解

### 3.1 四态：success / failed / blocked / recovered（L9）

```ts
export type ToolExecutionStatus = 'success' | 'failed' | 'blocked' | 'recovered';
```

前三个好理解，`recovered` 是本节的灵魂：**检测到相同幂等键已成功执行过，本次不重复执行，直接恢复历史结果**。调用方拿到 `status: 'recovered'` 就知道"这事办过了"，该提示用户"已执行"而不是装作刚成功。

### 3.2 幂等键与 Redis 三态（L90-107）

```ts
const idempotencyKey = input.sideEffect ? input.idempotencyKey ?? this.fingerprint(input) : undefined;
const redisKey = idempotencyKey ? `tool-execution:${idempotencyKey}` : undefined;
if (redisKey) {
  const previous = await this.redis.get(redisKey);
  if (previous?.startsWith('completed:')) {
    // → recovered，JSON.parse 恢复输出
  }
  const locked = await this.redis.setIfAbsent(redisKey, 'running', 3600);
  if (!locked && this.redis.isEnabled()) {
    // → blocked：相同幂等键正在执行或结果未知
  }
}
```

三个关键设计：

- **幂等键的三重来源**：调用方显式传 `idempotencyKey` → 没传则 `fingerprint(input)`（对请求内容做指纹）→ 只读工具（`sideEffect` 为假）根本不进幂等逻辑——**只有写操作需要幂等**。
- **`setIfAbsent('running')`**：并发防锁。两个请求同毫秒到达，只有一个能抢到锁，另一个 blocked——防止"请求还在路上、重试又发一版"的双写窗口。
- **TTL 1 小时**（`IDEMPOTENCY_TTL_SECONDS = 3600`）：这是当前缓存保护窗口，不是业务新意图的判定标准。新意图应有新的操作身份，过期后的迟到重试需远端幂等或结果查询保护。

### 3.3 unknown：诚实的第三态（L116-121）

```ts
} catch (error) {
  if (redisKey) await this.redis.set(redisKey, 'unknown', ...);
  return this.finish(..., { status: 'failed', ... });
}
```

**教学引导语**：注意异常时写进 Redis 的不是 `failed` 而是 **`unknown`**——请求可能已到达对方服务器（超时 ≠ 未执行）。下一次同幂等键的请求撞上 unknown，会在锁检查处 blocked："相同幂等键的操作正在执行或结果未知，**需查询结果后再继续**"。这是分布式系统最重要的一个纪律：**结果未知时，禁止盲目重试**——宁可停下来问，不可赌一把再写一次。

### 3.4 拒绝优先的审批（L71-88）

`approved = input.approvalGranted === true || input.approvalPolicy === 'auto'`——只有**显式授予**或**策略声明自动**才放行，其余一律 blocked："该写入型工具等待人工审批，系统按拒绝优先策略未执行。"审批事件三连：`approval.asked` → `approval.decided` → 结果——即使拒绝也留下完整痕迹（谁问的、策略是什么、结论如何）。

### 3.5 大结果的治理：预览 + Artifact 落盘（L42 / L135-140）

工具输出超 6000 字符时，事件里只留 `outputPreview`，完整结果落 Artifact 拿 `outputArtifactId`。**审计事件是给排障看的，不是数据仓库**——把几 MB 的检索结果塞进事件流，运营面板和 Redis 会先于业务挂掉。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：幂等键把"等价请求"当成了"不同请求"

- **现象**：用户重试后工具执行了两次，幂等保护完全没生效。
- **根因**：fingerprint 把时间戳、UUID 等每次变化的字段算进去了——两次"语义相同"的请求指纹不同，各拿各的 key，幂等形同虚设。
- **排查三步**：从 Redis 查 `tool-execution:*` 两个 key 的实际值对比 → 看 fingerprint 覆盖了哪些字段 → 把易变字段（时间戳/请求 ID）从指纹中剔除，或调用方显式传业务语义键（如 `order:{orderId}:refund`）。

### 坑点 2：把 unknown 当 failed 重试 → 双写事故

- **现象**：接口超时后框架自动重试，用户收到两封邮件 / 两笔扣款。
- **根因**：异常统一按"没执行"处理直接重试——但超时只代表"你不知道"，不代表"没发生"。
- **排查/预防**：对照本实现的三态区分：completed → 恢复；running/unknown → blocked 并提示"查询结果后再继续"。**任何写操作的重试策略必须先回答"上次到底执行了没"**。

## 五、讲师口播稿（约 300 字）

> 上节课我们让工具持证上岗，这节课讲上岗之后怎么安全干活。先讲一个真实事故的模型：Agent 调了一个发邮件的写工具，网络超时，框架一看"失败"，自动重试——但第一封邮件其实已经发出去了。用户收到两封。这是最温和的版本，如果工具是扣款呢？问题的根源是一个认知错误：把"超时"当成"没执行"。超时的真正含义是——你不知道。所以这一讲的执行外壳里，你会看到一个很少有人在 demo 里写的状态：unknown。执行异常时，幂等键下面写的不是 failed，是 unknown；下一次相同请求撞上它，不是重试，是拦下来告诉你：结果未知，先查再说。这是分布式系统的老纪律，Agent 时代一点没变新。除了 unknown，还有 recovered——检测到同样的操作已经成功过，直接返回历史结果，不碰第二次。四态：success、failed、blocked、recovered，每一个都是机器可读的承诺。学完这节，你的写工具才算真的敢上线。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 3 节](../README.md)）：制造重复调用 + 异常四态观察 + 消费四态的编排分支
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
