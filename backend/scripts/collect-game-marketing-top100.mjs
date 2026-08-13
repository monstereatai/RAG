import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const catalogPath = resolve(process.env.GAME_MARKETING_TOP100_CATALOG ?? join(root, 'eval/game-marketing-top100.catalog.json'));
const outputPath = resolve(process.env.GAME_MARKETING_TOP100_OUTPUT ?? join(root, 'eval/game-marketing-top100.dataset.json'));
const markdownDir = resolve(process.env.GAME_MARKETING_TOP100_MARKDOWN_DIR ?? join(root, 'eval/game-marketing-top100-markdown'));
const timeoutMs = Number(process.env.GAME_MARKETING_FETCH_TIMEOUT_MS ?? 15000);
const concurrency = Math.max(1, Number(process.env.GAME_MARKETING_FETCH_CONCURRENCY ?? 4));
const includeFallbackPaths = process.env.GAME_MARKETING_FETCH_CHILD_PATHS !== 'false';

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const fetchedAt = new Date().toISOString();
const jobs = catalog.games.flatMap((game) => {
  const paths = includeFallbackPaths ? ['', 'news', 'events', 'activity', 'community'] : [''];
  return paths.map((path) => ({
    game,
    url: path ? new URL(`${path.replace(/^\//, '')}/`, game.officialUrl).toString() : game.officialUrl,
    sourceType: path ? classifyPath(path) : 'official-site',
  }));
});

const results = [];
for (let index = 0; index < jobs.length; index += concurrency) {
  const batch = jobs.slice(index, index + concurrency);
  results.push(...await Promise.all(batch.map(fetchPage)));
}

const successful = results.filter((item) => item.status === 'fetched');
const documents = successful.map(toDocument);
const gameStatus = catalog.games.map((game) => {
  const items = results.filter((item) => item.game.name === game.name);
  return {
    ...game,
    fetchedPages: items.filter((item) => item.status === 'fetched').length,
    failedPages: items.filter((item) => item.status !== 'fetched').length,
    sources: items.map(({ url, sourceType, status, error, fetchedAt: itemFetchedAt }) => ({
      url, sourceType, status, error, fetchedAt: itemFetchedAt,
    })),
  };
});

const karpathyPlan = buildKarpathyPlan(catalog, fetchedAt);
const catalogMarkdown = buildCatalogMarkdown(catalog, gameStatus, fetchedAt);
await mkdir(markdownDir, { recursive: true });
await writeFile(join(markdownDir, '中国PC端与页游Top100公开资料目录.md'), catalogMarkdown);
await writeFile(join(markdownDir, 'Simple-Karpathy-Fast-Path-游戏运营营销资料方案.md'), karpathyPlan);
for (const document of documents) {
  await writeFile(join(markdownDir, `${safeName(document.id)}.md`), document.content);
}

const payload = {
  schemaVersion: 1,
  generatedAt: fetchedAt,
  domain: 'game-marketing-official-site',
  sourcePolicy: '只抓取公开可访问页面；不登录、不绕过验证码、不绕过 robots、不把失败页面伪造成事实。',
  rankingPolicy: catalog.rankingPolicy,
  rankingSources: catalog.rankingSources,
  games: gameStatus,
  results,
  documents: [
    {
      id: 'game-marketing-top100-catalog',
      title: '中国 PC 端与页游 Top100 公开运营营销资料目录',
      metadata: { evidenceLevel: 'public_catalog', documentType: 'general', platform: 'pc-h5' },
      content: catalogMarkdown,
    },
    {
      id: 'simple-karpathy-fast-path-game-marketing',
      title: 'Simple Karpathy Fast Path：游戏运营营销资料方案',
      metadata: { evidenceLevel: 'project-design', documentType: 'config', platform: 'pc-h5', route: 'simple' },
      content: karpathyPlan,
    },
    ...documents,
  ],
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  catalogPath,
  outputPath,
  markdownDir,
  gameCount: catalog.games.length,
  attemptedPages: jobs.length,
  fetchedPages: successful.length,
  documentCount: payload.documents.length,
  failedPages: results.filter((item) => item.status !== 'fetched').length,
}, null, 2));

async function fetchPage(job) {
  try {
    const response = await fetch(job.url, {
      headers: { 'user-agent': 'RAG-public-game-knowledge/1.0 (+public-source-snapshot)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ...job, status: 'failed', error: `HTTP ${response.status}` };
    const html = decodeResponseBody(await response.arrayBuffer(), response.headers.get('content-type'));
    const text = htmlToText(html);
    if (text.length < 80) return { ...job, status: 'empty', error: 'visible text too short' };
    return {
      ...job,
      status: 'fetched',
      fetchedAt,
      title: extractTitle(html) || job.game.name,
      content: text.slice(0, 18000),
      contentHash: createHash('sha256').update(text).digest('hex'),
    };
  } catch (error) {
    return { ...job, status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

function decodeResponseBody(buffer, contentType = '') {
  const bytes = new Uint8Array(buffer);
  const charset = /charset\s*=\s*["']?([^;"']+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (charset === 'gbk' || charset === 'gb2312' || charset === 'gb18030') {
    return new TextDecoder(charset === 'gb2312' ? 'gb18030' : charset).decode(bytes);
  }
  const mojibakeScore = (utf8.match(/[\u0080-\u009fӢ����������]/g) ?? []).length / Math.max(utf8.length, 1);
  if (mojibakeScore > 0.02) return new TextDecoder('gb18030').decode(bytes);
  return utf8;
}

function toDocument(item) {
  const { game } = item;
  const pageContent = dedupeSnapshotLines(item.content);
  const title = `${game.name}｜${labelFor(item.sourceType)}公开页面快照`;
  return {
    id: `top100-${game.rankType}-${game.rank}-${slug(game.name)}-${item.sourceType}-${item.contentHash.slice(0, 10)}`,
    title,
    metadata: {
      game: game.name,
      company: game.company,
      rankType: game.rankType,
      publicRank: game.rank,
      sourceUrl: item.url,
      fetchedAt: item.fetchedAt,
      documentType: item.sourceType,
      evidenceLevel: 'public_web_snapshot',
      simulated: false,
      sourceContentHash: item.contentHash,
    },
    content: [
      `# ${title}`,
      `- 榜单口径：${game.rankType === 'pc' ? 'PC 端候选 Top50' : '页游候选 Top50'}`,
      `- 候选名次：${game.rank}`,
      `- 公司：${game.company}`,
      `- 来源：${item.url}`,
      `- 抓取时间：${item.fetchedAt}`,
      `- 证据级别：公开网页快照（只代表页面公开内容，不代表内部运营规则）`,
      '',
      '## 页面可见内容',
      pageContent,
      '',
      '## 面向当前项目的可检索维度',
      `- 官网与页面模块：从页面标题、导航、公告、下载／预约／客服入口识别官网信息架构。`,
      `- 运营与活动：只抽取页面明确展示的活动、公告、版本、礼包或社区运营文案；未展示的规则标记为待确认。`,
      `- 营销素材：识别 Hero、PV、角色／玩法展示、新闻、FAQ、下载和转化入口。`,
      `- 工程验收：结合页面可见内容记录首屏、响应式、视频降级、地区语言、跳转和埋点待核项，不把推测写成事实。`,
    ].join('\n'),
  };
}

function dedupeSnapshotLines(value) {
  const seen = new Set();
  return value
    .split('\n')
    .filter((line) => {
      const key = line.trim();
      if (key.length < 8 || seen.has(key)) return key.length < 8;
      seen.add(key);
      return true;
    })
    .join('\n');
}

function buildKarpathyPlan(catalogData, timestamp) {
  return `# Simple Karpathy Fast Path：游戏运营营销公开资料方案\n\n- 版本：${timestamp}\n- 适用链路：Simple\n- 资料范围：中国 PC 端候选 Top50、页游候选 Top50的公开官网、活动、运营、营销和社区页面。\n- 关键原则：网页快照是证据，项目模板是方法；没有页面证据的奖励数值、预算、概率、接口字段和内部策略必须回答“待确认”。\n\n## 用户操作流程\n\n1. 用户在 AI 智能问答选择 Simple，输入“某游戏官网活动有哪些页面模块”“某页游周年庆活动如何拆页面和埋点”等问题。\n2. 系统将问题标准化，识别游戏名、平台、活动类型、运营／营销／官网／社区意图。\n3. 系统优先检索 Karpathy 编译索引中的游戏资料卡，再补充 Milvus 语义召回、BM25／Elasticsearch 关键词召回和父子块上下文。\n4. 系统做 RRF 融合（注：把多路检索结果按排名合并）、轻量重排和引用校验。\n5. 资料充分时，模型按“已知事实／可复用方法／待确认项／来源”加工回答；不会原样复制网页。\n6. 资料不足时，Simple 不自行编造，也不进入多 Agent 循环；返回低相关提示和需要补充的关键信息。\n\n## 服务端数据与状态流程\n\n1. 公开网页进入采集器，保存 URL、榜单口径、游戏名、公司、平台、抓取时间和 content hash（注：内容指纹，用于去重和更新判断）。\n2. 页面转成 Markdown 快照，写入 PostgreSQL 文档记录，并经过现有异步文档队列。\n3. 文档解析为父块、子块和 metadata（注：父块保留页面上下文，子块用于精确召回），同步到 Milvus、BM25／Elasticsearch、Karpathy 编译层和 Obsidian。\n4. Simple 查询只走 Fast Path：query normalize → intent tags → Karpathy／Obsidian 高优先级命中 → Hybrid Search → RRF → Rerank → citation gate（注：引用门禁）→ 结构化生成。\n5. 查询、命中来源、耗时、召回数量、引用覆盖率和最终状态写入 QueryLog，并上报 LangFuse Trace／Generation；Prometheus 采集延迟、错误、空召回和索引失败指标。\n6. 网页更新时按 content hash 生成新版本，旧版本进入 superseded（注：被新版本替代）状态；删除或失效时同步清理各索引，避免旧活动污染新回答。\n\n## Simple 输出契约\n\n- 结论：只写公开资料明确支持的内容。\n- 可复用拆解：页面模块、接口类别、埋点类别、风险和验收清单。\n- 待确认项：活动时间、预算、奖励、概率、资格、真实接口和内部数据。\n- 引用：至少给出来源页面 URL、游戏名和抓取时间。\n- 拒答边界：没有证据时不把相似游戏的做法改写成目标游戏事实。\n\n## 与 Auto／Agentic 的边界\n\n- Simple：固定单轮检索，低延迟，适合查官网模块、公开活动和通用拆解。\n- Auto：先执行 Simple；当检索充分性门禁不通过时，再升级 Agentic。\n- Agentic：拆分复杂问题，按子问题反复检索、图谱扩展、必要时调用网络搜索，再生成结构化方案。\n- 三条链路共用同一份公开资料版本、权限过滤、引用校验和 Bad Case 回归，不复制三套知识。\n\n## 本批次目录\n\n- PC 端候选：${catalogData.games.filter((item) => item.rankType === 'pc').length} 个。\n- 页游候选：${catalogData.games.filter((item) => item.rankType === 'web').length} 个。\n- 排名只用于建立采集范围，不能替代业务方对真实市场排名的确认。\n`;
}

function buildCatalogMarkdown(catalogData, statuses, timestamp) {
  const rows = statuses.map((item) => `| ${item.rankType === 'pc' ? 'PC' : '页游'} | ${item.rank} | ${item.name} | ${item.company} | ${item.fetchedPages} | ${item.failedPages} |`);
  return `# 中国 PC 端与页游 Top100 公开运营营销资料目录\n\n- 抓取时间：${timestamp}\n- 数据范围：官网、公开活动、运营公告、营销页面和社区入口。\n- 采集约束：只访问公开页面，不登录、不绕过验证码、不绕过 robots；失败页面不生成事实内容。\n- 排名说明：这是公开榜单候选采集目录，不宣称统一营收、DAU 或市场份额排名。\n\n## 榜单来源\n\n${catalogData.rankingSources.map((source) => `- [${source.name}](${source.url})：${source.scope}`).join('\n')}\n\n## 采集状态\n\n| 类型 | 候选名次 | 游戏 | 公司 | 成功页面数 | 失败／空页面数 |\n|---|---:|---|---|---:|---:|\n${rows.join('\n')}\n\n## 进入当前项目后的用途\n\n- 官网信息架构：Hero、PV、角色／玩法、新闻、下载／预约、FAQ、客服和适龄提示。\n- 活动运营：版本、周年庆、礼包、兑换码、任务、抽奖、回流和公告等公开可见内容。\n- 营销分析：页面入口、素材组织、转化动作、社区触点和地区适配线索。\n- 工程方案：页面结构、接口类别、状态机、埋点、风控、性能和上线验收待办。\n- 证据边界：网页没有写出的奖励、预算、概率、真实接口、用户数据和内部策略，统一标记“待确认”。\n\n## 入库链路\n\n公开页面 → Markdown 快照 → PostgreSQL 文档 → 父子切块 → Milvus 语义索引 + BM25／Elasticsearch 关键词索引 → Karpathy 编译索引 + Obsidian → Simple／Auto／Agentic 共用检索、引用校验和版本治理。\n`;
}

function htmlToText(html) {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\r/g, '\n'))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line, index, lines) => index === 0 || line !== lines[index - 1])
    .join('\n')
    .slice(0, 18000);
}

function extractTitle(html) {
  return decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;/g, "'").replace(/&quot;/gi, '"');
}

function classifyPath(path) {
  if (path === 'news') return 'campaign';
  if (path === 'events' || path === 'activity') return 'campaign';
  return 'community';
}

function labelFor(type) {
  return ({'official-site':'官网', campaign:'活动运营', community:'社区营销'})[type] ?? type;
}

function safeName(value) { return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').slice(0, 160); }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-'); }
