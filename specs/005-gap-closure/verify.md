# 验证记录

## 本地验证结果

- AC-01：`/rag/admin/quality/summary` 已接入 QA Ops 概览，并在 Agent 工作台展示回答率、引用率、拒答率、延迟和发布门禁失败原因。
- AC-02：危险请求通过 Domain Event Outbox 持久化脱敏审计，后台提供策略和事件查询；安全审计单测通过。
- AC-03：BullMQ 调度适配器支持 Job Scheduler、延迟、重试、去重 jobId；无 Redis 降级和一次性任务测试通过，应用内 Cron 仅作为无 Redis 降级。
- AC-04：索引巡检、批量修复和后台路由已接入；重建保留原文档 ID、ACL、生命周期、审核元数据并记录内容 SHA-256。
- AC-05：Agent 汇总包含成本、成功率、失败率、步骤准确率、恢复率及运行／工具／任务／交付四层指标，后台展示已接入。
- AC-06：Backend 与 Admin Backend 均提供 OpenAPI 严格检查脚本，设置 `OPENAPI_REQUIRED=true` 时服务不可用或路径／中文描述缺失会失败；本次服务未启动，非严格检查安全跳过。
- AC-07：Backend 全量 Jest：58 suites／274 tests 通过；`--detectOpenHandles` 无残留；backend、admin-backend、admin 构建通过；`git diff --check` 通过。
- AC-08：安全策略目录包含版本、生效时间和启用状态；审计与文档数据生命周期、脱敏和运营处理边界写入 `docs/SECURITY_AND_DATA_LIFECYCLE.md`。

## 未运行／外部依赖

真实 Redis 队列、Grafana、生产告警、真实数据库和索引、压测、CI/CD、备份灾备、低代码平台、企业 IAM／DLP／工单仍需线上环境或外部契约，未标记为本地通过。
