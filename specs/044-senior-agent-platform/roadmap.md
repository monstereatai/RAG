# 路线图：高级 Agent 平台能力补齐

## 目标

在保留现有 Simple／Auto／Agentic 三条问答链路边界的前提下，补齐 Agent Runtime、审批恢复、评测门禁和可观测性四个生产工程能力，形成可验证、可恢复、可运营的闭环。

## 交付切片

| 切片 | 内容 | 依赖 | 验收目标 |
| --- | --- | --- | --- |
| S1 | Agent Runtime 持久化、取消、重试、幂等与预算 | 现有 AgentLoop、Redis、运行记录 | 运行可查询、可恢复、不可重复执行副作用 |
| S2 | 审批与恢复强化 | S1 | 审批、驳回、局部重跑、未知副作用保护和故障恢复有回归证据 |
| S3 | 三链路评测与质量门禁 | 现有评测脚本、S1 运行记录 | Simple／Auto／Agentic 均有回归集、指标和可执行门禁 |
| S4 | 可观测性生产闭环 | S1、S2、S3 | Trace、Runtime Event、Prometheus、Langfuse、Run Center 可关联查询，并提供看板／告警模板 |

## 全局约束

- 不改变 Simple／Auto／Agentic 的路由语义。
- 公司内部信息仍强制走权限范围内的内部 RAG。
- 不把用户会话设定写入公共长期知识库。
- 不写入或打印密钥、Token、用户原文等高敏感信息。
- 每个检索相关改动必须模拟后台真实用户操作，分别验证三条链路。

## 外部依赖与风险

- PostgreSQL migration 需要先完成备份和迁移演练。
- CI 门禁只提交配置和脚本，不自动修改生产凭据。
- Langfuse、Prometheus、Grafana 未配置时，系统仍需保留本地降级能力。
