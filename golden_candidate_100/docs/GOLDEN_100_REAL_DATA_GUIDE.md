# AI Agent / RAG Golden Dataset：100 条候选 → 真实验收

> **当前交付是待人工标注的候选用例，不是已经通过验收的真实 Golden Dataset。** 数据集故意标记 `synthetic: true`、`review.approved: false`，来源、Doc/Chunk ID、真实 Agent Run 和正确答案均不虚构。

## 1. 题库构成

| 类型 | 场景 | 条数 |
| --- | --- | ---: |
| RAG | 直接事实检索 | 18 |
| RAG | 跨文档综合 | 12 |
| RAG | 历史版本 / 生效期 | 12 |
| RAG | ACL / 租户隔离 | 12 |
| RAG | 证据不足拒答 | 16 |
| Agent | 工具失败 / 重试 / 审计 | 15 |
| Agent | Checkpoint / 审批 / 恢复 | 15 |
| **合计** | **70 RAG + 30 Agent** | **100** |

Development 75 条，Holdout 25 条（17 RAG、8 Agent）。这是待标注题目分布，不代表真实通过率。

## 2. 哪些文件放到项目哪里？

把 ZIP 解压到 **RAG 仓库根目录**，保持如下位置：

```
apps/rag-api/
  eval/
    private-reviewed-golden.candidate.json      # 100 条候选问题；不包含真实答案
    private-reviewed-golden.evidence.candidate.json # 100 条来源标注空表
    private-agent-run-map.candidate.json        # 30 条 Agent → Run ID 空映射
  scripts/
    finalize-private-golden-dataset.mjs          # 人工证据校验 + 数据集冻结工具
docs/
  GOLDEN_100_REAL_DATA_GUIDE.md
  GOLDEN_100_CANDIDATES_REVIEW.md
```

**涉及真实业务的全部文件放在 `apps/rag-api/.tmp/private-golden/`，这里在仓库根 `.gitignore` 中已被 `.tmp/` 忽略。不要把真实资料、带答案的运行报告、Access Token 或审批人身份提交到公开仓库。**

## 3. 补齐真实知识库与来源

在 `apps/rag-api` 目录运行：

```bash
mkdir -p .tmp/private-golden/sources
cp eval/private-reviewed-golden.evidence.candidate.json .tmp/private-golden/annotations.json
cp eval/private-agent-run-map.candidate.json .tmp/private-golden/agent-run-map.json
```

把**真实业务、已脱敏**的来源快照（例如当前生效的活动规则、历史版本规则、上线审批单、接口设计、告警 SOP、工具审计记录）放入 `.tmp/private-golden/sources/`。来源快照必须能够匹配实际知识库中的 Doc ID / Chunk ID 或 Agent 真实事件，不允许创建虚假的 `doc-001` 充数。

然后人工填写 `.tmp/private-golden/annotations.json`：

- `provenance.kind`：确认是真实来源后，填 `sanitized_real_business`；同时把 `confirmedRealAndSanitized` 设为 `true`，填写**实际** `attestedBy` 和 `attestedAt`。不能只为通过校验而填。
- `cases[golden-001].sourceFiles`：对应的真实快照文件名列表，例如 `["approved-activity-policy-v3.txt"]`；至少 1 个。
- `sourceUri`：稳定且可追溯的来源 URI，如原始文档的内部索引 URL/知识库源 ID，**不能填示例假地址**。
- `sourceRevision`：文档实际版本标识、Commit、审核单号等。
- `expectedDocIds`：真实索引文档 ID。正常 RAG 问题至少 1 个；跨文档问题至少 2 个；拒答场景必须是空数组。
- `expectedChunkIds`：正常 RAG 问题必须填真实相关 chunk ID，不能把 Doc ID 代替 Chunk ID。
- `expectedClaims`：人工根据源文档标注的正确事实，必须与实际文本吻合。
- `forbiddenDocIds`：ACL 测试填确实不应被该测试用户访问的真实 Doc ID。
- `expectedVersions`：版本问题填 `{ "真实文档ID": "实际版本" }`。
- `expectedEvents`：Agent 必须填写真实事件类型和先后顺序；`forbiddenEvents` 可以是空数组。
- `sourceReviewer`：人工核对来源、正确性和期望证据后才填写 `approved:true`、真实 `reviewerId/reviewedAt`。**要求审核人和来源真实性确认人不同**。

如某个候选问题没有真实来源，应删改问题或补充实际资料，并保持不少于 100 条、至少 20 条 Holdout，不得用推测冒充事实。

### 注意：正式验收不只是填写 JSON

- ACL 案例需要**真实权限受限的测试身份**和实际检索过滤记录；当前采集器若仅使用一个统一 Token，无法独立证明跨角色 ACL 安全性。
- 版本案例需要服务端返回可核验的文档版本或可信运行审计；若 `ChatResponse.references` 不包含版本信息，当前采集器不能凭空填 `retrievedVersions`。
- Agent 工具故障、审批恢复必须来自真实 Agent Run 及持久化事件；候选清单不能代替运行。
- 来源审核是**入集前**的人审；答案是否正确、引用是否充分，需要**运行后**再次独立人审。

## 4. 冻结正式 Dataset（自动检查，不会自动批准）

在 `apps/rag-api` 目录执行：

```bash
node scripts/finalize-private-golden-dataset.mjs \
  --candidate eval/private-reviewed-golden.candidate.json \
  --evidence .tmp/private-golden/annotations.json \
  --out .tmp/private-golden/private-reviewed-golden.json
```

没有真实来源、标注或审核时，程序会给出前 30 条缺失提示并返回非 0 状态，**不会写正式文件**。通过时会校验现有 `verified-golden.mjs` 的生产 Dataset 契约并计算真实来源快照 SHA-256。

## 5. 使用真实 API 采集观测值

把 30 个真实 Agent Run ID 填到 `.tmp/private-golden/agent-run-map.json`。通过环境变量提供凭据，**不要把 Token 写到 JSON 文件里**。

```bash
export RAG_API_BASE_URL='http://127.0.0.1:3000/api/v1'
# RAG_EVAL_ACCESS_TOKEN / RAG_ADMIN_ACCESS_TOKEN 从本机安全环境注入

pnpm run verify:golden:capture -- \
  --dataset .tmp/private-golden/private-reviewed-golden.json \
  --agent-run-map .tmp/private-golden/agent-run-map.json \
  --out .tmp/evidence/private-golden-observations.draft.json
```

`--base-url` 可指定测试环境 API；ngrok 只用于**隔离测试**，不应暴露 Redis/PostgreSQL，也不要在公开仓库、日志或聊天里粘贴密钥。

## 6. 人工复核、正式门禁

在你已安装先前的 `agent_platform_final_evidence` 补丁（本地含 prepare/finalize review scripts）前提下：

```bash
pnpm run verify:golden:prepare-review -- \
  --dataset .tmp/private-golden/private-reviewed-golden.json \
  --capture .tmp/evidence/private-golden-observations.draft.json \
  --out .tmp/evidence/private-review-sheet.json

# 由独立审核人逐题查看实际答案、原始引用、工具执行轨迹和拒答情况。
# 只填写实际审核结论；失败案例必须保留 false。

pnpm run verify:golden:finalize-review -- \
  --dataset .tmp/private-golden/private-reviewed-golden.json \
  --capture .tmp/evidence/private-golden-observations.draft.json \
  --review .tmp/evidence/private-review-sheet.json \
  --out .tmp/evidence/private-golden-observations.reviewed.json

pnpm run verify:golden:business -- \
  --dataset .tmp/private-golden/private-reviewed-golden.json \
  --observations .tmp/evidence/private-golden-observations.reviewed.json \
  --out .tmp/evidence/private-golden-release.json

pnpm run verify:platform:all-evidence
```

注意：只在你实际本地有上述 `verify:golden:prepare-review` / `verify:golden:finalize-review` 命令时执行。若未安装，需先应用此前补丁，而不是绕过人审。

## 7. 真正的完成定义

- 100 条真实来源证据、至少 20 条 Holdout、7 类必须场景齐全。
- RAG 和 Agent 的 Holdout 都有真实运行观测，不缺失 Doc/Chunk、引用与持久事件。
- 独立审核源证据与运行结果，不因模型看起来回答正确就直接通过。
- 生产门禁要求 90% 总通过率、80% Recall@K、95% Agent Holdout 通过率，零 ACL 泄漏且 P95 不高于 30 秒（以现有代码为准）。
- 汇总检查通过，报告明确实验覆盖边界，不宣称 9/10 的客观认证。
