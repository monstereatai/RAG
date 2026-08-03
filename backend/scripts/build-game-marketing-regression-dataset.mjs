import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(
  __dirname,
  '..',
  'eval',
  'game-marketing-regression.dataset.json',
);
const checkOnly = process.argv.includes('--check');

const scenarios = [
  {
    id: 'new-character-gacha-sea',
    activityType: 'new-character',
    playbook: 'gacha',
    region: 'sea',
    platform: 'h5',
    title: '东南亚服新角色抽奖 H5 方案模板',
    content:
      '东南亚服新角色抽奖 H5 应先展示角色卖点、技能 PV、奖池信息、抽奖入口、中奖记录和 FAQ。抽奖类活动必须包含概率公示、奖池库存、中奖记录、奖励到账说明、防刷策略和客服入口。东南亚服需要检查英语、泰语、印尼语等多语言文案长度，活动时间按当地时区展示，支付和客服入口以地区配置为准。前端需要埋点 page_view、character_pv_play、draw_button_click、draw_result_view、reward_claim_click、customer_service_click。',
    asks: [
      ['东南亚服新角色抽奖 H5 技术方案要拆哪些模块？', ['角色卖点', '概率公示', '奖池库存', '中奖记录', '东南亚服', '埋点']],
      ['新角色抽奖活动为什么必须有概率公示和中奖记录？', ['抽奖', '概率公示', '中奖记录', '奖励到账']],
      ['东南亚服抽奖页上线前要检查哪些本地化问题？', ['英语', '泰语', '印尼语', '时区', '客服入口']],
    ],
  },
  {
    id: 'anniversary-hub-global',
    activityType: 'anniversary',
    playbook: 'campaign-hub',
    region: 'global',
    platform: 'pc-h5',
    title: '周年庆会场页通用模板',
    content:
      '周年庆会场页通常由 Hero、活动日历、登录礼、累计任务、抽奖入口、礼包兑换、版本回顾、PV 视频、新闻公告和 FAQ 组成。会场页要统一活动状态机：未开始、进行中、已结束、领奖中、库存不足、资格不符。上线验收要覆盖入口跳转、活动时间、奖励库存、规则文案、客服 FAQ、灰度开关、回滚方案和埋点漏斗。核心埋点包括 page_view、calendar_exposure、task_click、gift_claim_success、faq_click。',
    asks: [
      ['周年庆会场页一般包含哪些页面模块？', ['Hero', '活动日历', '登录礼', '累计任务', 'FAQ']],
      ['周年庆活动状态机要覆盖哪些状态？', ['未开始', '进行中', '已结束', '库存不足', '资格不符']],
      ['周年庆上线验收要检查哪些风险？', ['奖励库存', '规则文案', '客服 FAQ', '灰度', '回滚']],
    ],
  },
  {
    id: 'recharge-rebate-tw',
    activityType: 'recharge',
    playbook: 'rebate',
    region: 'tw',
    platform: 'h5',
    title: '台湾服充值返利活动模板',
    content:
      '台湾服充值返利活动需要明确充值档位、返利规则、订单状态、奖励发放、异常补偿和客服路径。具体返利比例、预算和活动时间必须由产品、运营和法务确认，知识库不能编造。技术方案应包含支付跳转、订单查询、返利资格、领奖接口、重复提交防护、支付失败兜底和到账延迟说明。台湾服要检查繁体文案、当地支付渠道、币种显示、客服入口和活动时间时区。埋点包括 pay_button_click、pay_redirect、pay_success、rebate_eligible_view、reward_claim_success。',
    asks: [
      ['台湾服充值返利活动前端要注意什么？', ['繁体', '支付渠道', '币种', '订单状态', '异常补偿']],
      ['充值返利活动有哪些接口和状态要考虑？', ['支付跳转', '订单查询', '返利资格', '领奖接口', '重复提交']],
      ['如果问具体返利比例是多少，系统应该怎么处理？', ['产品', '运营', '法务', '不能编造', '待确认']],
    ],
  },
  {
    id: 'wechat-share-growth-cn',
    activityType: 'growth',
    playbook: 'wechat-share',
    region: 'cn',
    platform: 'wechat-h5',
    title: '微信分享裂变活动前端模板',
    content:
      '微信分享裂变活动前端需要完成微信 JS-SDK 初始化、分享标题、分享缩略图、渠道参数、邀请关系、分享成功回调、防重复领取和登录态校验。页面要兼容微信内置浏览器，处理 iOS 与 Android 分享行为差异。风险项包括刷量、重复领取、邀请关系篡改、分享图失效和渠道参数丢失。埋点包括 share_button_click、share_panel_open、share_success、invite_bind_success、reward_claim_click。',
    asks: [
      ['微信分享裂变活动前端链路怎么拆？', ['微信 JS-SDK', '分享标题', '渠道参数', '邀请关系', '防重复领取']],
      ['微信内置浏览器里分享活动有哪些兼容风险？', ['微信内置浏览器', 'iOS', 'Android', '分享图', '渠道参数']],
      ['分享裂变活动需要哪些埋点？', ['share_button_click', 'share_success', 'invite_bind_success', 'reward_claim_click']],
    ],
  },
  {
    id: 'official-site-launch-global',
    activityType: 'official-site',
    playbook: 'landing-page',
    region: 'global',
    platform: 'pc-h5',
    title: '游戏官网 PC/H5 官网落地页模板',
    content:
      '游戏官网落地页需要突出游戏名、核心卖点、Hero KV、PV 视频、角色展示、游戏特色、新闻公告、下载入口、预约入口、FAQ、客服入口和适龄提示。PC/H5 官网要关注 SSR/SEO、首屏性能、图片压缩、CDN 缓存、响应式适配、视频懒加载和弱网兜底。海外官网还要检查多语言 SEO、地区 CDN、社媒分享图、隐私政策和 Cookie 提示。核心指标包括首屏 LCP、下载点击率、预约转化率和 PV 播放率。',
    asks: [
      ['游戏官网落地页要有哪些核心模块？', ['Hero KV', 'PV 视频', '角色展示', '下载入口', 'FAQ']],
      ['PC/H5 官网前端性能要重点检查什么？', ['SSR', 'SEO', '首屏性能', '图片压缩', 'CDN']],
      ['海外游戏官网上线前要检查哪些合规和地区问题？', ['多语言 SEO', '地区 CDN', '隐私政策', 'Cookie']],
    ],
  },
  {
    id: 'version-update-role-page',
    activityType: 'version-update',
    playbook: 'role-showcase',
    region: 'global',
    platform: 'h5',
    title: '版本更新与角色展示专题页模板',
    content:
      '版本更新专题页通常包含版本主题、核心改动、新角色展示、技能视频、预约/下载入口、更新公告、活动入口和 FAQ。角色展示模块需要素材清单：立绘、技能图标、技能视频、角色语音、分享图和多语言角色名。技术拆解要包含素材懒加载、视频播放降级、Tab/锚点导航、新闻接口、预约接口和分享配置。风险项包括素材缺失、视频加载失败、多语言文案溢出和旧版本缓存。',
    asks: [
      ['版本更新专题页应该包含哪些内容？', ['版本主题', '核心改动', '新角色展示', '技能视频', 'FAQ']],
      ['新角色展示页需要提前准备哪些素材？', ['立绘', '技能图标', '技能视频', '角色语音', '分享图']],
      ['角色专题页有哪些前端风险？', ['素材缺失', '视频加载失败', '多语言文案溢出', '旧版本缓存']],
    ],
  },
  {
    id: 'coupon-code-event',
    activityType: 'gift-code',
    playbook: 'redeem-code',
    region: 'global',
    platform: 'h5',
    title: '兑换码礼包活动模板',
    content:
      '兑换码礼包活动需要包含兑换码输入、格式校验、账号绑定、兑换资格、兑换结果、错误提示和客服 FAQ。接口清单包括 code_validate、code_redeem、user_bind_status、reward_status。常见异常包括兑换码不存在、已使用、已过期、地区不可用、账号未绑定、奖励发放延迟。风险项包括批量撞库、防刷限流、错误提示泄露规则和客服查询链路。埋点包括 code_input_focus、code_submit_click、redeem_success、redeem_fail、faq_click。',
    asks: [
      ['兑换码活动前端要做哪些状态和异常处理？', ['格式校验', '兑换资格', '已使用', '已过期', '账号未绑定']],
      ['兑换码礼包活动接口清单有哪些？', ['code_validate', 'code_redeem', 'user_bind_status', 'reward_status']],
      ['兑换码活动有什么安全和客服风险？', ['批量撞库', '防刷限流', '错误提示', '客服查询']],
    ],
  },
  {
    id: 'return-user-campaign',
    activityType: 'return-user',
    playbook: 'retention',
    region: 'global',
    platform: 'h5',
    title: '回流与留存活动模板',
    content:
      '回流活动面向一段时间未登录的玩家，通常包含回归礼包、连续登录、任务进度、好友召回、下载入口和客服入口。技术方案要明确用户资格判定、登录态、任务进度、奖励领取、召回关系和防重复领取。运营指标包括回流 UV、登录转化、任务完成率、礼包领取率和次日留存。无法从知识库推断具体未登录天数、礼包价值和预算，必须标记待确认。',
    asks: [
      ['回流活动一般有哪些玩法模块？', ['回归礼包', '连续登录', '任务进度', '好友召回', '下载入口']],
      ['回流活动技术方案要关注哪些接口或状态？', ['用户资格', '登录态', '任务进度', '奖励领取', '召回关系']],
      ['回流活动哪些具体规则不能由 RAG 编造？', ['未登录天数', '礼包价值', '预算', '待确认']],
    ],
  },
];

const promptVariants = [
  '请按知识库回答：',
  '业务负责人问：',
  '前端技术评审前确认：',
  '测试验收需要知道：',
];

const documents = scenarios.map((item) => ({
  id: item.id,
  title: item.title,
  metadata: {
    activityType: item.activityType,
    playbook: item.playbook,
    region: item.region,
    platform: item.platform,
  },
  content: `# ${item.title}\n${item.content}`,
}));

const queries = scenarios.flatMap((scenario) =>
  scenario.asks.flatMap(([ask, keywords], askIndex) =>
    promptVariants.map((prefix, variantIndex) => ({
      id: `${scenario.id}-q${askIndex + 1}-${variantIndex + 1}`,
      category: categoryFor(ask, scenario),
      query: `${prefix}${ask}`,
      sourceDocument: scenario.id,
      expectedKeywords: keywords,
      minKeywordHits: Math.min(4, Math.max(3, Math.ceil(keywords.length * 0.6))),
      requireCitation: true,
      expectRefusal:
        ask.includes('具体返利比例') ||
        ask.includes('不能由 RAG 编造') ||
        ask.includes('具体规则不能'),
      dimensions: {
        activityType: scenario.activityType,
        playbook: scenario.playbook,
        region: scenario.region,
        platform: scenario.platform,
      },
    })),
  ),
);

const graphSeed = {
  entityTypes: [
    'ActivityType',
    'Playbook',
    'PageModule',
    'Platform',
    'Region',
    'TrackingEvent',
    'ApiContract',
    'RiskItem',
    'Checklist',
  ],
  relationshipTypes: [
    'uses',
    'requires',
    'emits',
    'calls',
    'has_risk',
    'adapts',
    'constrains',
    'verifies',
  ],
  examples: [
    ['新角色', 'uses', '抽奖'],
    ['抽奖', 'requires', '概率公示'],
    ['抽奖页', 'emits', 'draw_button_click'],
    ['台湾服', 'adapts', '繁体文案'],
    ['微信 H5', 'constrains', '微信 JS-SDK'],
    ['上线检查', 'verifies', '埋点漏斗'],
  ],
};

const payload = {
  version: '2026-07-08',
  domain: 'game-marketing-official-site',
  description:
    '游戏活动、营销 H5、小程序活动页和 PC/H5 官网专项 RAG 评测集。覆盖新角色抽奖、周年庆会场、充值返利、微信分享裂变、游戏官网、版本专题、兑换码、回流活动；强调玩法识别、页面模块、接口、埋点、地区适配、风险和拒答边界。',
  documents,
  queries,
  graphSeed,
  metrics: [
    '玩法识别准确率',
    '必要模块覆盖率',
    '风险项召回率',
    '地区适配覆盖率',
    '引用命中率',
    '拒答正确率',
    '方案可用率',
  ],
};

if (checkOnly) {
  const existing = JSON.parse(await readFile(outputPath, 'utf8'));
  const report = validate(existing);
  console.log(JSON.stringify({ ...report, path: outputPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
} else {
  const report = validate(payload);
  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        path: outputPath,
        documents: payload.documents.length,
        queries: payload.queries.length,
      },
      null,
      2,
    ),
  );
}

function categoryFor(ask, scenario) {
  if (ask.includes('埋点')) return 'tracking';
  if (ask.includes('地区') || ask.includes('台湾') || ask.includes('东南亚') || ask.includes('海外')) {
    return 'regional-delivery';
  }
  if (ask.includes('不能') || ask.includes('具体返利比例')) return 'refusal-boundary';
  if (scenario.playbook === 'landing-page') return 'official-site';
  return 'solution-planning';
}

function validate(value) {
  const documentsOk = Array.isArray(value.documents) && value.documents.length >= 8;
  const queriesOk = Array.isArray(value.queries) && value.queries.length >= 80;
  const hasRefusal = value.queries?.some((item) => item.expectRefusal === true);
  const hasRegional = value.queries?.some((item) => item.category === 'regional-delivery');
  const hasTracking = value.queries?.some((item) => item.category === 'tracking');
  const hasGraphSeed =
    Array.isArray(value.graphSeed?.entityTypes) &&
    value.graphSeed.entityTypes.length >= 8 &&
    Array.isArray(value.graphSeed?.relationshipTypes) &&
    value.graphSeed.relationshipTypes.length >= 8;
  const queryShapeOk = value.queries?.every(
    (item) =>
      item.id &&
      item.query &&
      item.sourceDocument &&
      Array.isArray(item.expectedKeywords) &&
      item.expectedKeywords.length >= 3 &&
      item.requireCitation === true,
  );

  return {
    ok:
      documentsOk &&
      queriesOk &&
      hasRefusal &&
      hasRegional &&
      hasTracking &&
      hasGraphSeed &&
      queryShapeOk,
    documents: value.documents?.length ?? 0,
    queries: value.queries?.length ?? 0,
    coverage: {
      hasRefusal,
      hasRegional,
      hasTracking,
      hasGraphSeed,
      queryShapeOk,
    },
  };
}
