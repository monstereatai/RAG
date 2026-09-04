# 第 1 节自测 · 你学会了吗？

> 合上讲义独立完成，再对照底部答案。**通过标准：满分 12 拿 ≥10 分 + Lab 完成（FakeVectorStoreProvider 切换后上层零改动）。**

## 一、判断题（每题 1 分）

1. `VECTOR_STORE_PROVIDER=pgvector` 时项目可以直接跑，因为接口注释里写了 pgvector。
2. `getRuntimeStatus()` 把熔断状态（closed/open/half_open）暴露进接口，是设计失误——运维状态不该进业务接口。
3. `ILLMProvider.getModel()` 返回 LangChain 的 `BaseChatModel`，是权衡后有意为之的"泄漏"。

## 二、选择题（每题 1 分）

4. 环境变量写成 `milvuss`（拼写错误），服务的行为是？
   - A. 静默回退到 milvus
   - B. 启动时抛 `Unsupported vector store provider`，服务起不来
   - C. 运行时降级到 BM25

5. `similaritySearch(queryVector, k, userId?)` 中 `userId` 参数的核心意义？
   - A. 写审计日志
   - B. 检索层的租户过滤（多租户隔离的一环）
   - C. 按用户限流

6. `LlmGatewayPolicy.resolve('reasoning')` 与 `resolve('fast')` 相比，默认差异是？
   - A. 更高的输出上限（4096 vs 2048）+ 独立的 `LLM_REASONING_*` 预算环境变量组
   - B. 自动换更便宜的模型
   - C. 强制启用 fallback

## 三、简答题（每题 2 分）

7. 工厂在 `onModuleInit` 里对未知 provider 直接 throw，而不是回退到默认的 milvus——为什么这样设计是对的？
8. `getModel()` 泄漏 LangChain 类型的收益与代价各是什么？什么情况下应该收紧这个接口？

## 四、代码审查题（2 分）

9. 同学甲设计的接口：`search(query: string, k: number): Hit[]`（无 userId、无 getIndexInfo、无状态方法）。项目上线三个月后要做多租户 + 运维监控，他至少要改哪些地方？这个代价本来怎么避免？

---

## 参考答案（先做完再看）

1. **错**。接口注释预留了 pgvector，但工厂 switch 里没有它的 case——目前是"纸面可插拔"，需要补实现类 + case 才真可插拔（讲义 §3.2 坦白讲）。
2. **错**。可观测是一等公民：熔断状态进接口，运营后台才能展示降级原因（§3.1）。
3. **对**。为了零成本获得 `withStructuredOutput / stream`；代价是换非 LangChain SDK 时调用方要动（§3.3）。
4. **B**。`default: throw`，配置错误启动期暴露（坑点 1）。
5. **B**。第 7 课四层隔离的伏笔，检索层过滤（§3.1）。
6. **A**。maxTokens 4096 vs 2048，且 reasoning 任务读 `LLM_REASONING_*` 环境变量组（§3.4）。
7. 配置错误属于"程序员必须修"的问题：静默回退会让数据写进错误的存储且难以察觉；启动期 fail-fast 把发现成本降到最低。回退只该用于**运行期**的临时故障（熔断/降级），那是另一套机制。
8. 收益：结构化输出、流式等高级能力直接复用 LangChain 生态，不必重造抽象；代价：接口被 LangChain 类型污染，换 SDK 时调用方返工。当项目出现第二个非 LangChain 的 LLM 实现、且调用方开始依赖 getModel 做差异化逻辑时，就应该收紧（引入自己的能力接口）。
9. 至少改：接口签名（+userId）→ 所有实现类 → 所有调用点；监控则需要另开通道拿索引/熔断状态。避免方式：写接口前先枚举调用方场景清单（谁调用？带什么上下文？怎么观测？）——这正是本项目接口的三个答案（坑点 2）。

**计分**：判断/选择每题 1 分，简答/代码题每题 2 分，满分 12。
**通过标准**：≥10 分 + Lab 完成。未达标 → 重读 §3.2/§3.3 与坑点 2，隔天重做。
