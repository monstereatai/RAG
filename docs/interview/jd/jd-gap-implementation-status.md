# JD 差距本地补齐状态

更新时间：2026-07-07

## 本轮已本地实现

| 差距项 | 本轮实现 | 验证 |
|---|---|---|
| Prompt Injection 专项防护 | 新增 `prompt-injection.guard.ts`，对检索片段做本地检测和高风险行脱敏；生成 prompt 明确把检索片段视为不可信证据，不允许片段覆盖系统规则或触发工具调用 | `npm run eval:prompt-injection` ✅ 7/7；`npm run build` ✅ |
| Prompt Registry | 新增 `prompt-registry.ts`，记录 prompt name/version/owner/purpose/file/evals/rollback；新增 registry 校验脚本 | `npm run prompt:registry:check` ✅ |
| Tool Registry / 工具治理清单 | 新增 `tool-registry.ts`，记录 Bocha、Rerank、Graph、MCP 的 source/risk/permission/timeout/audit/fallback/owner；新增 registry 校验脚本 | `npm run tools:registry:check` ✅ |
| Agent 任务级评测脚手架 | 新增 `eval-agent-task-metrics.mjs`，覆盖 retrieval/refusal/conflict/citation/tool_degrade；支持 `AGENT_TASK_EVAL_LIVE=true` 时拉起项目级评测作为 task success gate | `npm run eval:agent-tasks` ✅ |
| 游戏活动/官网营销专项评测 | 新增 `game-marketing-regression.dataset.json` 和生成器，覆盖新角色抽奖、周年庆、充值返利、微信分享、游戏官网、版本专题、兑换码、回流活动等贴合主人经历的业务场景 | `npm run eval:game-marketing` ✅（8 文档 / 96 问题）；`npm run enterprise:readiness` ✅（12/12） |

## 仍是部分实现

| 差距项 | 当前状态 | 还差什么 |
|---|---|---|
| Prompt Injection 防护 | 有本地规则检测、片段脱敏、prompt 边界和样本评测 | 还缺真实红队样本、线上攻击日志回流、模型级安全判别器 |
| Prompt Registry | 有代码级 registry 和校验 | 还缺后台管理、灰度发布、线上 prompt 版本回放和回滚 UI |
| Tool Registry | 有代码级工具治理清单和校验 | 还缺后台工具市场、危险动作二次确认、工具调用审计入库 |
| Agent 任务级评测 | 有覆盖脚手架和 live gate 开关 | 还缺 task_success_rate、step_accuracy、tool_success_rate 的线上 trace 统计看板 |
| 游戏营销专项评测 | 有脱敏/仿真业务模板、96 条问题、GraphRAG seed 和面试证据文档 | 还缺真实历史活动复盘、真实组件规范、真实埋点规范和线上用户反馈 |
| 多模态检索 | 已有 Vision Provider、OCR/图片理解、ASR/TTS、sidecar 样本 | 还缺真实视觉向量、视频抽帧理解、文本搜图、以图搜图 |

## 仍未实现 / 不能本地硬装完成

| 缺口 | 原因 |
|---|---|
| A2A 协议 | 当前项目没有 Agent-to-Agent 协议接入；如果岗位明确要求 A2A，只能说了解概念，未落地 |
| 真实业务系统 API | 需要公司业务系统、权限、接口契约和测试环境；本地只能提供 MCP/工具接入框架 |
| SFT / RLHF / 模型训练 | 项目定位是 AI 应用工程，不做模型训练或强化学习 |
| 生产灰度 / A-B 实验 | 需要真实线上流量、实验平台和发布系统 |
| 租户级成本预算平台 | 当前只有估算和节点预算，没有真实租户账单、quota 和告警 |
| 真实生产 SLA | 需要目标机器、域名、证书、备份、监控、压测窗口和发布权限 |
| 真实 IAM / DLP / 金融合规系统 | 需要公司组织权限、数据分级、脱敏规则、审批流和审计口径 |

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
