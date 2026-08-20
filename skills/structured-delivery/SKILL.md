---
name: structured-delivery
description: 将多 Agent 中间结果整理为可审计的结构化 Artifact 和交接消息
tags: [Artifact, 交接物, 结构化, 多Agent, handoff]
---

# Structured Delivery Skill

每个阶段产物必须包含：

- producer：产出 Agent 或节点；
- input：使用的任务和证据；
- output：结构化结果；
- dependencies：前置产物；
- validation：验证结论；
- status：planned、running、completed 或 blocked。

大文本写入 Artifact，运行事件只保存摘要、Hash 和 Artifact ID，避免污染上下文和审计日志。
