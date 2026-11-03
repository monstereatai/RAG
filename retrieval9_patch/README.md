# RAG Hybrid Retrieval — Mainstream Hardening Patch (目标 9/10)

**基线**：`monstereatai/RAG` `main`，2026-11-03，commit `62656f403241903cff044aa7f32aad81309e14b9`。  
**状态**：离线补丁，**未写入 GitHub**；仅完成补丁脚本、回归用例和局部语法检查，**未完成你的完整仓库构建、真实 ES/PostgreSQL 测试，也不能声称已经达到 9/10**。

## 1. 主流链路（保留，不另造一套）

```
用户问题
  -> Query Planner（普通问题只保留原问题，复杂问题才多查询）
  -> 统一身份、Tenant/ACL、时间、项目、角色、版本约束
  -> [Elasticsearch BM25 | Elasticsearch kNN]（共享前置过滤，Embedding 与 BM25 并行）
  -> 描述/图片/图谱作为按需补充来源（文档描述仍依赖 Milvus 存储）
  -> 各通道 RRF -> PostgreSQL 权威片段回查与权限/版本二次校验
  -> 多查询全局融合（保留候选而不是提前裁剪成上下文）
  -> Rerank -> 全局扩展（源码只扩展同文件）
  -> ContextBuilder（一次最终裁剪）
  -> 有引用的 LLM 答案
```

技术选型保持 **PostgreSQL (source of truth) + Elasticsearch (BM25/kNN) + RRF + DashScope Rerank**，Redis/BullMQ 不变。Milvus 旧主向量索引保留兼容读，不新增写入；**不要立刻删除 Milvus**，因为文档摘要、图表/表格和媒体描述向量仍在使用。

## 2. 本次改造覆盖点

| 级别 | 改造 | 关键代码 |
|---|---|---|
| P0 | 生产环境描述向量命中后，回查源 Chunk 改用 PostgreSQL，不依赖本地 BM25 缓存 | `authoritative-chunk.service.ts`, `rag-chunk-policy.service.ts` |
| P0 | 图谱/图片证据权限与时间/项目过滤改由 PostgreSQL 批量校验 | `authoritative-chunk.service.ts`, `rag-retrieval.service.ts` |
| P0 | Milvus 兼容读返回的 Chunk 用 PostgreSQL 权威记录二次校验 | `retrieval-sources.ts`, `rag-retrieval.service.ts` |
| P0 | ES BM25、kNN 异常不再被误当成零命中；明确通道降级 | `elasticsearch.provider.ts`, `retrieval-sources.ts` |
| P0 | BM25 和 kNN 预过滤共享身份、业务范围、角色、生命周期、有效期 | `elasticsearch.provider.ts`, `retrieval-sources.ts` |
| P1 | Embedding 与 BM25 发起阶段并行，减少串行等待 | `retrieval-sources.ts` |
| P1 | 多查询分支先返回候选，再全局 RRF/Rerank/扩展/组装 | `rag-retrieval.service.ts`, `rag-types.ts` |
| P1 | 无新增 Obsidian 证据时，不再重复调用 ContextBuilder | `rag-answer.service.ts` |
| P1 | Code RAG 不跨不同源文件做邻居扩展，ZIP 文档按文件控制占比 | `retrieval-postprocessor.ts`, `context-builder.ts` |
| P1 | ES 增加代码文件、符号、全限定符号、语言的精确匹配字段 | `elasticsearch.provider.ts` |
| P1 | Code RAG 引用添加 `filePath / symbol / L起始-L结束` | `context-builder.ts` |
| P1 | Qwen Rerank 指令改成企业文档/源码语义 | `dashscope-rerank.service.ts` |
| P1 | 更新与 ES 优先策略不一致的旧测试，并增加 5 个安全/代码回归用例 | `retrieval-sources.spec.ts`, `retrieval9-hardening.spec.ts` |

## 3. 安装（先确认当前无未提交的重要改动）

解压 ZIP，确保 `apply_retrieval9.py` 和 `retrieval9-hardening.spec.ts` 在同一目录；在 Mac 终端运行：

```bash
cd /Users/monster/Documents/GitHub/code/RAG

git branch --show-current      # 预期 main
git rev-parse HEAD              # 对照上面的基线 SHA
git status --short              # 建议工作区无未提交的修改

# 下面路径替换成你解压 ZIP 的实际目录
python3 /path/to/retrieval9_patch/apply_retrieval9.py "$PWD" --check
python3 /path/to/retrieval9_patch/apply_retrieval9.py "$PWD"

pnpm install --frozen-lockfile
pnpm --filter backend build
pnpm --filter backend exec jest --runInBand \
  retrieval9-hardening.spec.ts \
  retrieval-sources.spec.ts \
  retrieval-postprocessor.spec.ts \
  context-builder.spec.ts \
  rag.service.retrieval-gates.spec.ts
pnpm --filter backend run eval:rag
```

`--check` 会预先验证所有代码锚点，**不会写文件**；若当前主分支与本补丁基线有差异，脚本会报错而不是猜测修改位置。首次应用会在项目**同级目录**下创建 `RAG-retrieval9-backups/时间戳/...` 原始文件备份，不会污染 Git 工作区；重复运行会检查已应用项。

**新增代码字段要生效，需要在 ES 给已有源码 Chunk 重新索引**（新索引会自动创建相关字段；原索引会增量补 mapping）。旧 Chunk 在未重建前仍走原内容 BM25，不会自动出现新增 `codeSymbol` 字段。

## 4. 验收（做到这些才能评估 9/10）

1. `NODE_ENV=production`，本地 BM25 关闭，描述召回仍能通过 PostgreSQL 返回可见的原文 Chunk。
2. 模拟 ES BM25 或 kNN 单路失败，结果标记 `diagnostics.degradedChannels`，另一正常通道继续工作；全部失败须明确报错，不能返回伪“无结果”。
3. 用户 A 无法通过 BM25、kNN、描述、图谱、图片或邻居扩展拿到用户 B/其他租户的资料；涵盖分享文档与角色限制。
4. 查询 2025 年 9–10 月历史规则：有效期闭开区间、废止版本、draft/archived、时间精度全部正确。
5. ZIP 含多文件、同名函数、重复符号：召回引用精确到文件路径与行号，同一查询可引用不同文件，但邻居扩展不能把另一个文件当成邻居。
6. 对比改造前后 Golden Dataset：Recall@10、nDCG@10、Context Precision、引用准确率、正确回答率不能显著回退；评估 P50/P95 时延及 ES/PG 负载。
7. 额外测试大规模 `allowedDocIds`、描述索引损坏、映射旧版本、请求超时、索引重建过程中的查询一致性。

## 5. 暂不做的事情

- **不删除 Milvus**：媒体/表格描述索引仍需它；等真实验证迁移完再按业务收益决定是否停用。
- **不新增 LightRAG/GraphRAG 引擎**：当前图谱为可选证据来源，不属于基础检索必须链路。
- **不默认启用多轮 Agent 检索**：简单问题只跑基本 Hybrid，复杂问题按计划分解。
- **不把静态验收当 9 分**：剩余任务包括真实集成压测、增量索引一致性、动态 Token 预算与 Golden Dataset。实际运行前只是“向 9 分优化的补丁”。

## 6. 本包的验证边界

本地离线测试包括：Python 语法、安装器的预检查/写入/备份/幂等、所选 TypeScript 片段语法与 Jest 新用例的 TypeScript **语法**检查。未执行实际 NestJS 类型检查、真实 Jest、ES/PostgreSQL 请求或生产延迟测试。请以你机器上的 `pnpm --filter backend build` 和完整回归结果为准。
