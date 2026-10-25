> 后续 simple/auto 延迟优化和模型依赖故障注入结果见 [LATENCY_AND_MODEL_RESILIENCE_2026-10-18.md](./LATENCY_AND_MODEL_RESILIENCE_2026-10-18.md)。

# 独立 Golden Set Live 性能评测报告

- 评测日期：2026-10-18
- 数据集：`backend/eval/independent-golden.dataset.json`
- 数据集版本：`independent-golden-2026-10-18`
- 评测脚本：`backend/scripts/eval-rag-project.mjs`
- 结果文件：`backend/.tmp/evidence/project-rag-e2e-latest.json`
- 数据性质：`synthetic: true`，合成回归数据，不代表真实企业私有数据

## 1. 评测目标

这次不是 mock 评分，而是跑真实的 HTTP、PostgreSQL/pgvector、Redis、Milvus、Elasticsearch 和 Qwen 模型链路，回答以下问题：

1. 文档上传、索引和检索链路是否能完整工作。
2. simple 和 auto 两种问答模式是否能稳定返回带引用答案。
3. 检索命中率、MRR、nDCG 是否可测。
4. 拒答和版本冲突是否有专门行为。
5. 真实 LLM 链路下的平均延迟和 P95 延迟是多少。
6. 是否存在会导致整轮评测中断的可靠性问题。

## 2. 环境

| 组件 | 状态 |
|---|---|
| Backend | NestJS 11，当前代码构建后运行在 `http://localhost:3000/api/v1` |
| Node.js | 22 |
| PostgreSQL | pgvector 容器，已连接 |
| Redis | 7.4 容器，已连接 |
| Milvus | v2.4.4 容器，已连接 |
| Elasticsearch | 8.13 容器，已连接 |
| LLM | Qwen，通过真实 API 调用 |
| Langfuse | 已启用，真实云端配置存在 |
| 操作系统 | macOS 本地开发环境 |

## 3. 数据规模

| 项目 | 数量 |
|---|---:|
| 上传文档 | 23 |
| 问题数 | 24 |
| 评测模式 | simple、auto |
| 实际问答次数 | 48 |
| 参与检索指标计算的问题数 | 46 |
| 拒答问题 | 1 |
| 版本冲突问题 | 1 |
| query 级错误 | 0 |

覆盖方向：

- HR 差旅制度
- 财务采购与报销
- IT 权限和 API 版本管理
- 运维事故响应与备份
- 安全事件与敏感数据
- 产品发布与工程评审
- 客服 SLA
- 数据指标与保留策略
- 采购供应商准入
- 行政会议
- 销售折扣
- 法务合同
- QA P0 缺陷
- 隐私删除时限
- 无证据拒答
- 版本冲突

## 4. 最终结果

### 4.1 总体指标

| 指标 | 结果 |
|---|---:|
| 总通过率 | 100% |
| 关键词准确率 | 100% |
| 引用通过率 | 100% |
| 拒答准确率 | 100% |
| 版本冲突处理准确率 | 100% |
| 检索命中率 Hit@K | 100% |
| 检索 MRR | 100% |
| 检索 nDCG | 100% |
| query 级错误数 | 0 |
| 平均延迟 | 7,775 ms |
| P95 延迟 | 15,443 ms |

### 4.2 分模式结果

| 模式 | 通过 | 平均延迟 | P50 | P90 | P95 | 最大延迟 |
|---|---:|---:|---:|---:|---:|---:|
| simple | 24/24 | 8,812 ms | 8,365 ms | 13,584 ms | 14,557 ms | 15,546 ms |
| auto | 24/24 | 6,739 ms | 5,867 ms | 11,804 ms | 15,443 ms | 16,632 ms |

### 4.3 文档上传性能

最后一次完整评测的 23 次上传：

| 指标 | 结果 |
|---|---:|
| 上传数 | 23 |
| 平均上传耗时 | 6,739 ms |
| P50 | 6,844 ms |
| P95 | 7,491 ms |
| 最大上传耗时 | 8,960 ms |

说明：上传包含切块、质量检查、向量化、Milvus / Elasticsearch 写入等步骤，是离线异步能力；这个耗时不能直接和在线问答延迟比较。

## 5. 评测过程中发现并修复的问题

### 5.1 评测脚本：逻辑文档 ID 与真实 docId 未映射

第一轮完整跑分只有 2.1%，但检索实际返回了引用。

根因：

- Golden set 里写的是逻辑 ID，例如 `independent-hr-travel`。
- 上传后服务端生成 UUID docId。
- 评分脚本拿逻辑 ID 和 UUID 比较，导致全部检索判失败。

修复：

- 建立 `uploadedDocIdByDatasetId` 映射。
- 评分时把预期逻辑 ID 转换为真实上传 docId。
- 修复后检索命中率恢复到 95.65%，最终达到 100%。

这是评测脚本缺陷，不是 RAG 检索能力缺陷。

### 5.2 文档生命周期误判

问题：

- 文档正文包含 `deprecated` 时，`detectLifecycleStatus` 把整篇文档标成 `deprecated`。
- 结果“API 版本下线规则”文档无法被正常检索。

根因：

- 生命周期检测对整个正文做关键词匹配，而不是只读取显式元数据字段。

修复：

- 只有显式字段 `lifecycleStatus`、`生命周期状态`、`文档状态`、`状态` 才参与判断。
- 正文讨论 deprecated 不再改变整篇文档生命周期。
- 新增单元测试覆盖“正文提及 deprecated”和“显式状态废弃”两种场景。

### 5.3 simple 模式拒答仍返回引用

问题：

- 模型已经明确回答“片段中未提及，知识库完全没有记录”，但接口仍返回 4 条引用，`retrievalSufficient=true`。
- 这会让前端误以为存在证据。

修复：

- 增加无答案响应识别。
- 当回答明确表示“片段中未提及 / 知识库中没有 / 完全没有记录”时：
  - 清空 references；
  - `retrievalSufficient=false`；
  - 保留拒答文本。

### 5.4 数据集断言过严

问题：

- “生产系统权限默认有效期是多久？”实际正确回答了 120 天。
- 数据集却要求同时回答“重新申请”，导致误判。

修复：

- 该问题只要求 `120 天`。
- 版本冲突题接受“替代 / 生效 / 优先 / 冲突 / 历史”等明确版本语义。

### 5.5 上游模型连接不稳定

过程中出现过一次真实 Qwen 连接错误：

- 单次 chat 请求因上游连接错误最终返回 500。
- 故障请求在服务端挂起时间过长，导致整轮评测在 27/48 时中断。

已有改进：

- 评测脚本增加单题超时。
- 增加一次自动重试。
- 单题最终失败会记录为失败结果，不再中断整轮 48 题。

仍需生产治理：

- 后端 LLM 调用需要明确的请求级 timeout。
- 需要 circuit breaker、连接池健康检查和降级策略。
- 建议将“模型超时后返回受控兜底”纳入 SLA 测试。

## 6. 结论

### 6.1 好的部分

- 在受控的 23 文档、24 问题数据集上，真实链路已经能完整跑通。
- simple 和 auto 两种模式都达到 24/24。
- 检索 Hit@K、MRR、nDCG 都是 100%。
- 引用返回、无证据拒答、版本冲突均有可验证行为。
- 上传、切块、向量索引、混合检索、生成和评测形成完整闭环。
- 已经具备工程化回归和性能观测的基础。

### 6.2 不能过度解读的部分

这是合成数据上的 100%，不能直接宣称：

- 真实企业问答准确率 100%。
- 私有知识库检索 100% 命中。
- 生产并发场景下仍是这个延迟。
- 真实用户复杂追问、多跳问题、表格和长文档都稳定。

真实判断还需要：

1. 用脱敏后的真实私有文档和真实业务问题替换 golden set。
2. 至少扩展到 100～300 个真实问题，并做人工标注。
3. 并发压测：10 / 20 / 50 QPS，观察 P95、错误率和资源占用。
4. 注入 Qwen timeout、Milvus unavailable、ES unavailable 做故障演练。
5. 在接近生产的 CPU / 内存 / 网络资源下重测。

### 6.3 当前项目判断

基于这次完整 live 回归：

- 作为企业 RAG 工程原型：完成度较高，核心链路真实可跑。
- 作为生产系统：还不能下“好”的最终结论，主要短板是对外部模型依赖的稳定性和真实业务数据验证。
- 最优先优化项：降低平均延迟和 P95，补齐 LLM 调用 timeout / retry / circuit breaker，然后做真实私有数据评测。

## 7. 复现命令

```bash
cd backend

PROJECT_EVAL_BASE_URL=http://localhost:3000 \
PROJECT_EVAL_DATASET=eval/independent-golden.dataset.json \
PROJECT_EVAL_MODES=simple,auto \
PROJECT_EVAL_REQUIRE_LIVE=true \
PROJECT_EVAL_CHAT_TIMEOUT_MS=120000 \
PROJECT_EVAL_CHAT_RETRIES=1 \
node scripts/eval-rag-project.mjs
```

结果写入：

```text
backend/.tmp/evidence/project-rag-e2e-latest.json
```
