# JD 差距本地补齐状态

更新时间：2026-08-10

## 本轮已本地实现

| 差距项 | 本轮实现 | 验证 |
|---|---|---|
| Prompt Injection 专项防护 | 新增 `prompt-injection.guard.ts`，对检索片段做本地检测和高风险行脱敏；生成 prompt 明确把检索片段视为不可信证据，不允许片段覆盖系统规则或触发工具调用 | `npm run eval:prompt-injection` ✅ 7/7；`npm run build` ✅ |
| Prompt Registry | 新增 `prompt-registry.ts`，记录 prompt name/version/owner/purpose/file/evals/rollback；新增 registry 校验脚本 | `npm run prompt:registry:check` ✅ |
| Tool Registry / 工具治理清单 | 新增 `tool-registry.ts`，记录 Bocha、Rerank、Graph、MCP 的 source/risk/permission/timeout/audit/fallback/owner；新增 registry 校验脚本 | `npm run tools:registry:check` ✅ |
| Agent 任务级评测脚手架 | 新增 `eval-agent-task-metrics.mjs`，覆盖 retrieval/refusal/conflict/citation/tool_degrade；支持 `AGENT_TASK_EVAL_LIVE=true` 时拉起项目级评测作为 task success gate | `npm run eval:agent-tasks` ✅ |
| 游戏活动/官网营销专项评测 | 新增 `game-marketing-regression.dataset.json` 和生成器，覆盖新角色抽奖、周年庆、充值返利、微信分享、游戏官网、版本专题、兑换码、回流活动等贴合主人经历的业务场景 | `npm run eval:game-marketing` ✅（8 文档 / 96 问题）；`npm run enterprise:readiness` ✅（12/12） |
| 模型网关策略 | 新增 `LlmGatewayPolicy`，统一任务路由、主备模型、超时、输出上限和成本预算；由 `LlmProvider` 暴露策略查询 | `backend npm run build` ✅；策略单测 ✅ |
| 运营采纳指标 | 新增 RAG Ops `qa/adoption-summary` 和 `smoke:adoption`，统计活跃用户、复访用户、回答率、反馈覆盖率和正向反馈率 | `npm run smoke:adoption` ✅ |

## 仍是部分实现

| 差距项 | 当前状态 | 还差什么 |
|---|---|---|
| Prompt Injection 防护 | 有本地规则检测、片段脱敏、prompt 边界和样本评测 | 还缺真实红队样本、线上攻击日志回流、模型级安全判别器 |
| Prompt Registry | 有代码级 registry 和校验 | 还缺后台管理、灰度发布、线上 prompt 版本回放和回滚 UI |
| Tool Registry | 有代码级工具治理清单和校验 | 还缺后台工具市场、危险动作二次确认、工具调用审计入库 |
| Agent 任务级评测 | 有覆盖脚手架和 live gate 开关 | 还缺 task_success_rate、step_accuracy、tool_success_rate 的线上 trace 统计看板 |
| 游戏营销专项评测 | 有脱敏/仿真业务模板、96 条问题、GraphRAG seed 和面试证据文档 | 还缺真实历史活动复盘、真实组件规范、真实埋点规范和线上用户反馈 |
| 多模态检索 | 已有 Vision Provider、OCR/图片理解、ASR/TTS、sidecar 样本 | 还缺真实视觉向量、视频抽帧理解、文本搜图、以图搜图 |
| LangFuse 生产观测 | 已有真实 trace、generation、flush、health、token 和成本字段 | 还缺生产看板、告警规则和长期留存配置 |

## 性能监控口径

项目不是只依赖 LangFuse，而是采用双层监控：

- LangFuse：观测单次问答和 Agent 轨迹，定位节点／模型耗时、首 Token、总耗时、Token、成本、工具调用、重试和降级原因。
- Prometheus：观测服务整体运行状态，统计 QPS、成功率、错误率、P50／P95／P99、并发、超时、熔断以及 CPU、内存、Redis、数据库和队列健康。

当前已完成 LangFuse 真实云端上报和本地性能基准验证；生产化仍需配置 LangFuse Dashboard、Prometheus 告警、采样脱敏、长期留存和真实流量 SLA。

## 仍未实现 / 不能本地硬装完成

| 缺口 | 原因 |
|---|---|
| A2A 协议 | 当前项目没有 Agent-to-Agent 协议接入；如果岗位明确要求 A2A，只能说了解概念，未落地 |
| 真实业务系统 API | 需要公司业务系统、权限、接口契约和测试环境；本地只能提供 MCP/工具接入框架 |
| SFT / RLHF / 模型训练 | 项目定位是 AI 应用工程，不做模型训练或强化学习 |
| 生产灰度 / A-B 实验 | 需要真实线上流量、实验平台和发布系统 |
| 租户级成本预算平台 | 已有模型路由成本预算策略和成本字段 | 还缺真实租户账单、quota 和告警 |
| 真实生产 SLA | 需要目标机器、域名、证书、备份、监控、压测窗口和发布权限 |
| 真实 IAM / DLP / 金融合规系统 | 需要公司组织权限、数据分级、脱敏规则、审批流和审计口径 |

## 生产环境待补闭环总表

以下项目已明确记录为后续环境事项，当前不纳入“本地核心功能已完成”的结论：

| 事项 | 已具备 | 仍需真实环境完成 |
|---|---|---|
| 真实业务数据验收 | 评测脚手架、模拟专项数据、Bad Case 回归 | 真实文档、问题、标准答案、引用和失败样本 |
| 生产级延迟、成本、稳定性 | local 性能门禁、成本字段、30 次 DAG 稳定性回放 | 目标机器、真实单价、目标并发和长期 SLA |
| Redis Checkpointer 多实例恢复 | 两个独立进程共享 Redis 的恢复 smoke | 多副本编排、实例崩溃、切换、幂等和清理 |
| LangFuse 生产可观测 | 真实 trace／generation／flush／health 和成本字段 | 生产项目看板、告警、脱敏、采样和长期留存 |
| 真实业务长期回归 | 固定脚本、JSONL 历史和三链路回放 | 真实业务数据长期运行、版本对比和质量趋势 |
| 用户采纳率 | adoption summary 接口和本地统计 | 真实用户流量、采纳、返工、人工接管和节省工时 |
| 生产部署与高可用 | 本地服务、共享 Redis、部署检查清单 | 域名、证书、密钥、备份、灰度、回滚和多副本 |
| IAM／DLP／租户治理 | ACL、userId 隔离、审计和模型成本策略 | 企业 IAM、数据分级脱敏、租户配额、账单和合规审计 |

## 新增脚本

```bash
cd backend
npm run eval:prompt-injection
npm run prompt:registry:check
npm run tools:registry:check
npm run eval:agent-tasks
npm run eval:game-marketing
```

## 面试说法更新

```text
之前我把 Prompt Injection、Prompt Registry、工具治理和 Agent 任务级评测列为差距。现在本地已经补了基础工程能力：检索片段会做提示注入检测和脱敏，Prompt 有 registry 和绑定评测，工具有风险/权限/超时/降级登记，Agent 任务评测有覆盖脚手架和 live gate。

但这仍不是完整生产平台。生产级还要接真实红队样本、线上 trace、后台管理、工具审计入库、灰度发布、租户成本预算和真实合规系统。
```
