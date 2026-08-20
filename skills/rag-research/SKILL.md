---
name: rag-research
description: 为 Agent 选择混合检索、引用校验和证据整理策略
tags: [RAG, 检索, 引用, evidence]
---

# RAG Research Skill

适用于需要事实依据、多个检索角度或引用来源的问题。

执行约束：

1. 先拆分问题，再执行关键词、语义、图谱和必要的联网检索。
2. 每个结论绑定证据 ID，不把检索结果直接当作最终答案。
3. 证据不足时明确标记 needs_more 或待确认，不编造事实。
4. 输出前执行引用覆盖和低相关拒答检查。
