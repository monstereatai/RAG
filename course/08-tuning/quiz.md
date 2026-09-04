# 第 8 节自测 · 你学会了吗？

> 用法：合上讲义，独立做完 9 题，再对照答案。每题可追溯到讲义章节，答错重读对应小节。
>
> **通过标准：满分 12 分拿 ≥ 10 分 + Lab 调参演练完成（含一次故障演练截图）= 本节通过。**

## 一、判断题（每题 1 分）

1. 三路检索改成 `Promise.all` 并发后，只要任何一路不 reject，总延迟就等于最慢一路的延迟。
2. Rerank 服务调用失败时应该向上抛错，让用户明确知道本回答未经精排。
3. 上下文预算只需要统计 chunk 正文长度，引用格式的开销可以忽略。

## 二、选择题（每题 1 分）

4. 熔断打开期间（`MILVUS_CIRCUIT_OPEN_MS = 30000`），新的检索请求会？
   - A. 继续打 Milvus，等满超时后降级
   - B. 直接走降级链（ES kNN / BM25），不再打 Milvus
   - C. 返回 500，等熔断半开

5. RRF 融合相比"BM25 分数 + 余弦相似度直接相加"的核心优势？
   - A. 计算更快
   - B. 只用排名不用分数，天然规避两路分数量纲不可比
   - C. 可以自动学权重

6. 对抗 lost-in-the-middle 的手段是？
   - A. 把最重要的 chunk 放最前面，其余随机
   - B. `arrangeForLongContext` 偶数位证据放开头、奇数位放结尾
   - C. 把上下文整体压缩成摘要

## 三、简答题（每题 2 分）

7. `applyRerank` 的三处防御（候选不足跳过 / 同引用检测 / catch 降级）分别对应什么真实故障场景？
8. 七条军规里哪两条是提示注入防线？为什么说它和"入库前高风险隔离"构成双层防御——两层各挡住什么？

## 四、代码审查题（2 分）

9. 以下朴素实现有 4 个问题，对照本节讲过的方案逐一指出：

```ts
async function answer(query: string) {
  const base = await badCaseFlywheel.retrieveMatches(query, 2);
  const vec = await milvus.search(embed(query), { topK: 5 });
  const obsidian = await obsidianKnowledge.search(query);
  const reranked = await rerankService.rerank(query, vec, 5);
  const context = reranked.map((c, i) => `[${i}] ${c.content}`).join('\n\n');
  return llm.chat(`请基于以下资料回答：\n${context}\n问题：${query}`);
}
```

---

## 参考答案（先做完再看）

1. **对**，但前提是每路必须自带 `.catch` 降级——任何一路 reject，`Promise.all` 整体 reject，延迟和可用性双输（§一 方案 C）。
2. **错**。失败降级原序返回、`applied: false` 进溯源——精排是增强件不是必经件，不能阻断主链路（§二 方案 C）。
3. **错**。`[片段 N｜hit]` 每条固定 +32 字符开销，不算就是隐性超支（踩坑清单 #4）。
4. **B**。熔断打开的意义就是停止打故障服务，让流量直接走降级链，30 秒后半开试探（§一 方案 A）。
5. **B**。BM25 分数无上界、余弦在 [0,1]，直接相加等于让 BM25 永远主导；RRF 只看每路的排名（§二 方案 B）。
6. **B**。长上下文里模型对开头和结尾的注意力最强，把证据均匀铺到首尾而非中部（§三 方案 B 第 4 步）。
7. ① 候选 < 2：精排无意义，省一次 API 调用；② `reranked === candidates` 同引用：第三方 SDK 静默短路时原样返回输入，不识别就会误标 `applied: true`；③ catch 降级：远端 API 抖动/超时，主链路不能跟着挂（§二 优化后代码）。
8. 第 6、7 条。入库隔离挡住**成为索引的一部分**（高风险内容根本不进检索）；军规挡住**已入库内容在生成时下指令**（片段只能当证据不能当指令）。双层缺一：只挡入库，漏网内容仍可在生成时劫持；只挡 Prompt，恶意内容仍会污染检索与引用（§三 方案 A）。
9. ① 三路**串行**（延迟 sum）且任一路失败整体崩——应 `Promise.all` + 每路 catch；② `rerankService` 无 try/catch，第三方一抖就 500；③ 上下文无预算/去重/配额/首尾重排——该走 ContextBuilder 四步；④ Prompt 只有一句"请基于以下资料回答"，无引用要求、无"未提及就明说"、无注入防线——对照七条军规补齐（§一 C、§二 C、§三 A/B）。

**计分**：判断/选择每题 1 分，简答/代码题每题 2 分，满分 12 分。
**通过标准**：≥ 10 分 + Lab 完成（Prometheus 基线、超时三组对比、关停 Milvus 故障演练截图）。未达标 → 按错题对应章节重读，隔天重做。
