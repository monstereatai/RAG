# 后端增强计划归档

> 原始日期：2026-06-30｜校准日期：2026-08-03｜状态：本地开发项已完成，外部验收项迁移

本文档原来记录 BullMQ、短期记忆、Mem0 管理、部署模板和 Vision 接入方案。对应本地开发工作均已完成，不再作为待办事实源。

## 已完成

- [x] BullMQ 文档异步处理队列、Worker、状态 API 和 Redis 降级。
- [x] Redis 短期记忆滑动窗口、结构化摘要和上下文注入。
- [x] Mem0 cloud／local Provider、记忆 API 和管理后台页面。
- [x] `../../docs/architecture/DEPLOYMENT_CHECKLIST.md` 与 `scripts/deploy.sh` 部署模板。
- [x] Vision mock／OpenAI-compatible Provider，图片／视频上传调用及失败降级。
- [x] 27 个私密模拟文档、193 条业务问题、GraphRAG 种子、组织权限和多模态模拟包。
- [x] 修复六岗位 Qwen 20 秒超时预算过短问题；连续三次完整 DAG 共 18／18 模型调用成功、0 降级。

## 仍未完成

- [ ] 使用真实公司原件和 50～100 条真实毒题重新评测。
- [ ] 接入真实组织系统、GraphRAG 数据源和视觉／视频模型。
- [ ] 在三个以上时间窗口完成至少 30 次完整六岗位回放，验证 Qwen 长时间稳定性和正式配额。
- [ ] 在目标规格机器完成性能、容量和长时间稳定性测试。
- [ ] 完成登录后的 Agent Ops E2E 与生产部署验收。

当前真实进度以根目录 `ROADMAP.md` 为准，详细生产化差距见 `docs/plans/remaining-enhancement-plan.md`。本文件只保留历史决策上下文，避免旧勾选项继续误导后续开发。
