import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const outputPath = resolve(
  process.env.GAME_MARKETING_PUBLIC_OUTPUT ??
    'eval/game-marketing-public-sources.dataset.json',
);
const timeoutMs = Number(process.env.GAME_MARKETING_FETCH_TIMEOUT_MS ?? 12000);

const companies = [
  '诗悦网络', '百田游戏', '腾讯游戏', '网易游戏', '米哈游', '三七互娱',
  '库洛游戏', '灵犀互娱', '4399', '深蓝互动', '益世界', '多益网络',
  '贪玩游戏', '星辉游戏', '中手游', '完美世界', '莉莉丝游戏', '叠纸游戏',
  'FunPlus', '盛趣游戏', '巨人网络', '吉比特', '心动网络', '鹰角网络',
  '沐瞳科技', '友塔游戏', '途游游戏', '波克城市', '冰川网络', '创梦天地',
  '迷你玩', '凉屋游戏',
];

// 只放公开且可验证的代表性入口；其余公司生成脱敏模拟模板，不冒充真实内部资料。
const publicSources = [
  {
    id: 'tencent-games-official',
    company: '腾讯游戏',
    url: 'https://www.tencent.com/zh-cn/products/tencent-games/',
    documentType: 'official-site',
  },
  {
    id: 'netease-games-community',
    company: '网易游戏',
    url: 'https://app.netease.com/',
    documentType: 'community',
  },
  {
    id: 'mihoyo-community',
    company: '米哈游',
    url: 'https://bbs.mihoyo.com/index.html',
    documentType: 'community',
  },
  {
    id: 'mihoyo-honkai-official',
    company: '米哈游',
    url: 'https://bh3.mihoyo.com/main',
    documentType: 'official-site',
  },
];

const fetched = [];
for (const source of publicSources) {
  fetched.push(await fetchPublicSource(source));
}

const simulatedDocuments = companies.map((company) => ({
  id: `simulated-${slug(company)}`,
  title: `${company} 游戏活动与官网营销通用模板（模拟）`,
  metadata: {
    company,
    activityType: 'official-site-and-campaign',
    region: '待确认',
    platform: 'pc-h5',
    evidenceLevel: 'simulated',
    simulated: true,
  },
  content: [
    `# ${company} 游戏活动与官网营销通用模板（模拟）`,
    '本文是用于 RAG 链路、结构化 Artifact 和回归评测的脱敏模拟资料，不代表该公司的真实内部规范。',
    '常见页面模块：Hero 主视觉、PV 视频、角色或玩法展示、活动规则、任务／抽奖入口、奖励领取、公告、FAQ、客服和下载入口。',
    '常见接口模式：活动配置、用户资格、任务进度、奖励领取、奖励状态、公告和客服查询；真实路径、字段、错误码和权限必须由业务负责人确认。',
    '常见埋点：page_view、module_exposure、primary_cta_click、task_submit、reward_claim_success、faq_click；正式事件名和字段以埋点平台规范为准。',
    '常见风险：活动状态切换、重复提交、奖励幂等、库存不足、弱网、素材失败、多语言文案溢出、时区和地区合规。',
    '上线验收：主流程、接口异常、权限、地区语言、性能、埋点、灰度开关和回滚方案均需验证。',
  ].join('\n'),
}));

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  domain: 'game-marketing-official-site',
  simulated: true,
  evidencePolicy: '公开网页只作为来源快照；公司级通用模板均标记 simulated，不得当作真实业务事实。',
  companies,
  publicSources: fetched,
  documents: [
    ...fetched
      .filter((item) => item.status === 'fetched' && item.content)
      .map((item) => ({
        id: item.id,
        title: `${item.company} 公开官网／社区页面快照`,
        metadata: {
          company: item.company,
          sourceUrl: item.url,
          fetchedAt: item.fetchedAt,
          documentType: item.documentType,
          evidenceLevel: 'public_web_snapshot',
          simulated: false,
        },
        content: item.content,
      })),
    ...simulatedDocuments,
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      ok: true,
      outputPath,
      companyCount: companies.length,
      publicSourceCount: fetched.filter((item) => item.status === 'fetched').length,
      simulatedDocumentCount: simulatedDocuments.length,
      failedSources: fetched.filter((item) => item.status !== 'fetched').map((item) => item.url),
    },
    null,
    2,
  ),
);

async function fetchPublicSource(source) {
  try {
    const response = await fetch(source.url, {
      headers: { 'user-agent': 'RAG-public-source-snapshot/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const html = await response.text();
    if (!response.ok) {
      return { ...source, status: 'failed', error: `HTTP ${response.status}` };
    }
    const rawContent = stripHtml(html);
    const content = [
      rawContent.slice(0, 12000),
      rawContent.length < 300
        ? `页面快照补充说明：该公开页面文本较少，当前仅记录页面标题和可见文案；不可据此推断未展示的活动规则、接口字段、奖励数值或内部流程。来源类型：${source.documentType}。来源地址：${source.url}。`
        : '',
    ].filter(Boolean).join('\n\n');
    return {
      ...source,
      status: content ? 'fetched' : 'empty',
      fetchedAt: new Date().toISOString(),
      content,
    };
  } catch (error) {
    return {
      ...source,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function stripHtml(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-');
}
