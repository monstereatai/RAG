# 游戏运营营销公开资料与 Karpathy 方案

## 目标

为当前游戏官网活动营销 Agentic RAG 平台补充一批可公开验证的行业资料，覆盖中国 PC 端候选 Top50 和页游候选 Top50 的官网、活动、运营、营销和社区页面。资料只用于页面结构、运营玩法、营销组织、埋点、风险和验收方法的检索与方案生成，不冒充企业内部事实。

## 榜单口径

本项目采用公开榜单入口建立候选采集范围，当前保存的来源是：

- [17173 游戏排行榜](https://newgame.17173.com/rank-list.html)：PC／网游候选榜单。
- [17173 热游排行榜](https://top.17173.com/list-2-0-0-0-0-0-0-0-0-3.html)：网游与页游公开热度入口。

榜单会随时间变化，不能把本地的 1—50 写成统一营收、DAU 或市场份额排名。每批数据都保存榜单来源、候选名次、抓取时间和网页 URL；网页访问失败时记录失败状态，不生成假的游戏资料。

## 用户操作流程

1. 运营或研发执行 `cd backend && npm run game:top100`，抓取公开官网和常见公开入口。
2. 在 `backend/eval/game-marketing-top100-markdown/` 查看目录、Simple 方案和每个成功页面的 Markdown 快照。
3. 执行 `GAME_MARKETING_PUBLIC_DATASET=eval/game-marketing-top100.dataset.json npm run game:import-public-sources`，提交异步入库。
4. 在文档管理页查看任务状态、文档标题、来源 URL、证据级别和索引状态。
5. 在 Simple 问答中提问官网模块、公开活动玩法、营销入口、社区运营或上线验收问题，答案会展示引用和待确认项。
6. 如果网页更新，重新抓取并按内容指纹形成新版本；如果网页不可访问，保留失败记录并人工确认是否更换官方入口。

## 数据与状态流程

```text
公开榜单来源
  → 候选游戏目录（PC 50 + 页游 50）
  → 游戏官方 URL
  → 公开页面抓取（官网／新闻／活动／社区）
  → HTML 清洗为 Markdown 快照
  → sourceUrl、publicRank、rankType、company、fetchedAt、contentHash
  → PostgreSQL 文档与异步任务
  → 父子切块（注：父块保留页面上下文，子块用于精确召回）
  → Milvus 语义索引 + BM25／Elasticsearch 关键词索引
  → Karpathy compiled/index（注：把来源编译成可直接检索的知识卡）
  → Obsidian raw／notes／compiled／index
  → Simple／Auto／Agentic 共用检索、权限、版本、引用和回归链路
```

抓取内容分为三类：公开网页快照、项目设计文档、真实业务资料。前两类可以本地验证，真实活动预算、奖励、概率、内部接口、用户数据和组织权限仍必须由业务方提供。

## Simple 中的 Karpathy Fast Path

Simple 不把网页原文原样交给模型，而是先使用 `Simple-Karpathy-Fast-Path-游戏运营营销资料方案.md` 作为流程契约，再从游戏资料卡中取证：

1. 识别游戏、平台、活动类型以及官网／运营／营销／社区意图。
2. 优先读取 Karpathy compiled/index，再补 Milvus 语义召回、BM25／Elasticsearch 关键词召回和父子块上下文。
3. 用 RRF（注：把多路检索结果按排名融合）和轻量重排合并证据。
4. 按“公开事实、可复用拆解、待确认项、来源”加工回答。
5. 通过 citation gate（注：引用门禁）检查结论是否有来源；没有证据就拒答或标记待确认。
6. 查询结果写入 QueryLog，并将耗时、空召回、引用覆盖率和模型调用上报 LangFuse；Prometheus 采集延迟、错误、索引失败和降级指标。

Simple 的边界是固定单轮 Fast Path，不在资料不足时自行循环编造。Auto 可以在充分性门禁不通过时升级 Agentic；Agentic 才负责拆子问题、反复检索、图谱扩展和必要的网络搜索。三条链路共用同一份资料版本和索引，不复制三套知识。

## 当前批次落盘结果

运行脚本后，以 `backend/eval/game-marketing-top100.dataset.json` 为准：

- 目录：100 个候选游戏，PC 端 50 个、页游 50 个。
- 成功页面：最新批次实际抓到 127 个公开页面，保留 URL、抓取时间和内容指纹。
- 入库文档：目录文档、Simple Karpathy 方案文档和通过质量门禁的网页快照；当前 108 份唯一目标文档全部完成索引。
- 质量门禁：1 个《失落的方舟》页面因为登录模块重复内容过多，改为基于同一公开页面的去重摘要卡入库；原始完整 Markdown 仍保留在本地，不把重复登录内容放入检索上下文。
- 失败页面：其他 HTTP 失败、超时或空页面保留 URL 和原因，不生成事实内容。

## 运行与入库命令

```bash
cd /Users/monster/Documents/GitHub/code/RAG/backend
npm run game:top100
GAME_MARKETING_PUBLIC_DATASET=eval/game-marketing-top100.dataset.json npm run game:import-public-sources -- --only-public
```

导入器使用已有异步上传接口；接口内部会进入 `KarpathyObsidianIngestService`，因此成功导入后会同时写入 RAG 文档索引和 Obsidian/Karpathy 编译链路。不要把含有登录态、验证码、付费内容或个人信息的页面加入目录。

文档 Worker 默认并发为 2；本地批量验收可临时设置 `DOCUMENT_QUEUE_CONCURRENCY`，服务重启后恢复默认值。导入器支持按文件名跳过已入库文档、429 重试和批次延迟，避免重复任务污染索引。
