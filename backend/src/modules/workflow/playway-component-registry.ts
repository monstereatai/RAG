/**
 * Playway 营销组件规则注册表。
 *
 * 这是组件的机器可读单一事实源：Markdown 用于人工阅读，运行时检索和
 * Schema 校验必须依赖这里，避免模型输出不存在的组件。
 */
export type PlaywayActivity =
  | 'new-server-reservation'
  | 'private-domain-acquisition'
  | 'engagement'
  | 'win-back';

export type PlaywayRuleRisk = 'low' | 'medium' | 'high';

export interface PlaywayComponentRule {
  type: string;
  category: string;
  displayName: string;
  description: string;
  keywords: string[];
  activities: PlaywayActivity[];
  requires: string[];
  configFields: string[];
  emits: string[];
  risk: PlaywayRuleRisk;
  compliance: string[];
}

export interface PlaywayActivityTemplate {
  id: string;
  activity: PlaywayActivity;
  name: string;
  goal: string;
  requiredComponents: string[];
  optionalComponents: string[];
  requiredApis: string[];
  requiredEvents: string[];
  acceptanceChecks: string[];
  riskNotes: string[];
}

export interface PlaywayActivityGraph {
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ source: string; target: string; relation: string }>;
}

const ALL_ACTIVITIES: PlaywayActivity[] = [
  'new-server-reservation',
  'private-domain-acquisition',
  'engagement',
  'win-back',
];

const ACTIVITY_LABELS: Record<PlaywayActivity, string[]> = {
  'new-server-reservation': ['新服预约', '新服', '预约', '开服'],
  'private-domain-acquisition': ['私域拉新', '私域', '社群', '拉新'],
  engagement: ['游戏促活', '促活', '活跃', '日常'],
  'win-back': ['游戏回流', '回流', '召回', '流失'],
};

const rules = (
  type: string,
  category: string,
  displayName: string,
  description: string,
  options: Partial<
    Pick<
      PlaywayComponentRule,
      | 'keywords'
      | 'activities'
      | 'requires'
      | 'emits'
      | 'risk'
      | 'compliance'
    >
  > = {},
): PlaywayComponentRule => ({
  type,
  category,
  displayName,
  description,
  keywords: options.keywords ?? [displayName, category],
  activities: options.activities ?? ALL_ACTIVITIES,
  requires: options.requires ?? ['activityInfo'],
  configFields: options.requires ?? ['activityInfo'],
  emits: options.emits ?? [`${type}_view`],
  risk: options.risk ?? 'low',
  compliance: options.compliance ?? [],
});

const entries: Array<
  [string, string, string, string, Partial<PlaywayComponentRule>?]
> = [
  [
    'common',
    'address-form',
    '填写地址',
    '收货或联系地址表单',
    { requires: ['login'], emits: ['address_submit'], risk: 'medium' },
  ],
  [
    'common',
    'role-bind',
    '绑定角色（通用）',
    '账号与游戏角色绑定',
    {
      requires: ['login'],
      emits: ['role_bind'],
      risk: 'high',
      compliance: ['账号与角色归属校验'],
    },
  ],
  [
    'common',
    'role-bind-variant',
    '绑定角色（变体）',
    '绑定角色的交互变体',
    {
      requires: ['login'],
      emits: ['role_bind'],
      risk: 'high',
      compliance: ['账号与角色归属校验'],
    },
  ],
  ['common', 'download-game-modal', '下载游戏（弹出式）', '弹窗引导下载客户端'],
  [
    'common',
    'invite-records',
    '邀请记录',
    '邀请好友与奖励明细',
    { requires: ['login', 'inviteStats'] },
  ],
  [
    'common',
    'login',
    '登录',
    '账号登录入口',
    { requires: [], emits: ['login_success'], risk: 'medium' },
  ],
  [
    'common',
    'login-overseas',
    '海外登录',
    '海外第三方账号登录',
    {
      requires: [],
      emits: ['login_success'],
      risk: 'medium',
      compliance: ['地区与隐私政策'],
    },
  ],
  ['common', 'completion-toast', '完成活动提示', '任务完成反馈提示'],
  ['common', 'instructions', '说明', '活动说明文案区'],
  [
    'common',
    'realname-verify',
    '实名认证',
    '防沉迷合规实名校验',
    {
      requires: ['login'],
      emits: ['realname_verified'],
      risk: 'high',
      compliance: ['实名与防沉迷'],
    },
  ],
  [
    'common',
    'my-rewards-table',
    '我的奖励（表格）',
    '奖励明细表格',
    { requires: ['login', 'rewardRecords'] },
  ],
  [
    'common',
    'my-rewards-list',
    '我的奖励（列表）',
    '奖励明细列表',
    { requires: ['login', 'rewardRecords'] },
  ],
  ['common', 'activity-rules-modal', '活动规则（弹出式）', '活动规则弹窗'],
  ['framework', 'banner', 'Banner', '页头主视觉图'],
  ['framework', 'navbar', '导航栏', '顶部导航'],
  ['framework', 'tabbar', 'Tabbar', '页签或底部导航'],
  [
    'framework',
    'region-menu',
    '地区菜单',
    '多地区切换',
    { compliance: ['地区可用性'] },
  ],
  ['framework', 'language-menu', '语言菜单', '多语言切换'],
  [
    'framework',
    'floating-gift',
    '浮动礼包',
    '悬浮礼包入口',
    { requires: ['rewardConfig'] },
  ],
  ['framework', 'activity-rules', '活动规则', '规则页或入口'],
  [
    'framework',
    'task-rewards',
    '任务奖励',
    '任务奖励总览区',
    { requires: ['taskConfig', 'rewardConfig'] },
  ],
  ['framework', 'download-game', '下载游戏', '下载引导入口'],
  [
    'framework',
    'customer-service',
    '智齿客服',
    '客服会话入口',
    { emits: ['customer_service_open'] },
  ],
  [
    'task',
    'task-countdown',
    '任务倒计时',
    '任务或活动剩余时间',
    { requires: ['activityWindow'] },
  ],
  [
    'task',
    'task-invite-progress',
    '邀请好友进度条',
    '邀请人数进度',
    { requires: ['login', 'inviteStats'], emits: ['invite_progress_view'] },
  ],
  [
    'task',
    'task-jump',
    '跳转任务',
    '跳转指定页面完成任务',
    { emits: ['task_jump'] },
  ],
  [
    'task',
    'task-daily-recharge',
    '每日充值',
    '每日充值任务',
    {
      requires: ['login', 'paymentStatus'],
      emits: ['recharge_success'],
      risk: 'high',
      compliance: ['支付结果以后端为准'],
    },
  ],
  [
    'task',
    'task-daily-share',
    '每日分享',
    '每日分享任务',
    { requires: ['login'], emits: ['share_complete'] },
  ],
  [
    'task',
    'task-invite-poster',
    '邀请好友（海报）',
    '生成邀请海报分享',
    {
      requires: ['login', 'inviteCode'],
      emits: ['invite_share'],
      risk: 'medium',
    },
  ],
  [
    'task',
    'task-invite',
    '邀请好友',
    '邀请好友任务',
    {
      requires: ['login', 'inviteCode'],
      emits: ['invite_complete'],
      risk: 'medium',
    },
  ],
  [
    'task',
    'task-login-game',
    '登录游戏',
    '登录游戏完成任务',
    {
      requires: ['login', 'roleBind'],
      emits: ['game_login_complete'],
      risk: 'medium',
    },
  ],
  [
    'task',
    'task-mall-recharge',
    '商城充值',
    '商城充值任务',
    {
      requires: ['login', 'paymentStatus'],
      emits: ['recharge_success'],
      risk: 'high',
    },
  ],
  [
    'task',
    'task-qr-code',
    '二维码任务',
    '扫码任务',
    { requires: ['login'], emits: ['qr_scan_complete'], risk: 'medium' },
  ],
  [
    'task',
    'task-redpacket',
    '红包任务',
    '红包类任务',
    {
      requires: ['login', 'redpacketConfig'],
      emits: ['redpacket_task_complete'],
      risk: 'high',
      compliance: ['金额与提现风控'],
    },
  ],
  [
    'task',
    'task-join-team',
    '入队任务',
    '加入队伍任务',
    { requires: ['login', 'teamInfo'], emits: ['team_join'] },
  ],
  [
    'task',
    'wechat-subscribe',
    '微信消息订阅',
    '微信订阅消息授权',
    {
      requires: ['wechatAuth'],
      emits: ['subscribe_success'],
      risk: 'medium',
      compliance: ['订阅授权可撤回'],
    },
  ],
  [
    'task',
    'task-refresh',
    '刷新任务状态',
    '手动刷新任务状态',
    { requires: ['taskStatus'], emits: ['task_refresh'] },
  ],
  [
    'task',
    'task-progress',
    '任务进度',
    '任务完成度展示',
    { requires: ['taskStatus'] },
  ],
  [
    'task',
    'task-progress-bar',
    '任务进度条',
    '任务进度条展示',
    { requires: ['taskStatus'] },
  ],
  [
    'lottery',
    'lottery-grid',
    '宫格抽奖',
    '九宫格抽奖',
    {
      requires: ['login', 'lotteryConfig'],
      emits: ['lottery_draw'],
      risk: 'high',
      compliance: ['概率与奖品公示'],
    },
  ],
  [
    'lottery',
    'lottery-free',
    '自由抽奖',
    '免费次数抽奖',
    {
      requires: ['login', 'lotteryConfig'],
      emits: ['lottery_draw'],
      risk: 'high',
      compliance: ['概率与奖品公示'],
    },
  ],
  [
    'lottery',
    'lottery-paid-tier',
    '付费分层抽奖',
    '按付费档位分层奖池',
    {
      requires: ['login', 'paymentStatus', 'lotteryConfig'],
      emits: ['lottery_draw'],
      risk: 'high',
      compliance: ['支付、概率与奖品公示'],
    },
  ],
  [
    'lottery',
    'lottery-wheel',
    '转盘抽奖',
    '大转盘抽奖',
    {
      requires: ['login', 'lotteryConfig'],
      emits: ['lottery_draw'],
      risk: 'high',
      compliance: ['概率与奖品公示'],
    },
  ],
  [
    'lottery',
    'lottery-winner-carousel',
    '中奖轮播',
    '中奖结果轮播展示',
    {
      requires: ['winnerRecords'],
      emits: ['winner_carousel_view'],
      compliance: ['隐私脱敏'],
    },
  ],
  [
    'lottery',
    'lottery-winners',
    '中奖名单',
    '中奖用户公示',
    { requires: ['winnerRecords'], compliance: ['隐私脱敏'] },
  ],
  ['community', 'community-link', '社群链接', '社群跳转链接'],
  ['community', 'community-link-entry', '社群-链接', '社群链接入口变体'],
  ['community', 'community-modal', '社群-弹出层', '社群引导弹层'],
  ['community', 'carousel', '轮播图', '内容轮播'],
  [
    'team',
    'team-create',
    '创建队伍',
    '创建组队',
    { requires: ['login'], emits: ['team_create'], risk: 'medium' },
  ],
  [
    'team',
    'team-dissolve',
    '解散队伍',
    '解散组队',
    {
      requires: ['login', 'teamOwner'],
      emits: ['team_dissolve'],
      risk: 'medium',
    },
  ],
  [
    'team',
    'team-join',
    '加入队伍',
    '加入指定队伍',
    { requires: ['login', 'teamInfo'], emits: ['team_join'] },
  ],
  [
    'team',
    'team-list',
    '队伍列表',
    '可加入队伍列表',
    { requires: ['teamStats'] },
  ],
  ['team', 'team-info', '队伍信息', '队伍详情', { requires: ['teamStats'] }],
  [
    'team',
    'team-points',
    '队伍积分',
    '队伍积分展示',
    { requires: ['teamStats'] },
  ],
  [
    'team',
    'team-invite',
    '邀请组队',
    '邀请好友组队',
    { requires: ['login', 'inviteCode'], emits: ['team_invite'] },
  ],
  [
    'team',
    'team-member-list',
    '队伍成员列表',
    '成员列表',
    { requires: ['teamStats'] },
  ],
  [
    'team',
    'team-members',
    '队伍成员',
    '成员展示卡片',
    { requires: ['teamStats'] },
  ],
  [
    'recharge',
    'recharge-combo-tasks',
    '结伴充值任务集',
    '组队充值任务合集',
    { requires: ['login', 'teamInfo', 'paymentStatus'], risk: 'high' },
  ],
  [
    'recharge',
    'recharge-cumulative-lottery',
    '累计充值抽奖',
    '累充档位抽奖',
    { requires: ['login', 'paymentStatus', 'lotteryConfig'], risk: 'high' },
  ],
  [
    'recharge',
    'daily-lottery',
    '每日抽奖',
    '每日免费抽奖',
    { requires: ['login', 'lotteryConfig'], risk: 'high' },
  ],
  [
    'recharge',
    'points-exchange',
    '积分兑换',
    '积分商城兑换',
    {
      requires: ['login', 'pointsBalance', 'rewardConfig'],
      emits: ['points_exchange'],
      risk: 'medium',
    },
  ],
  [
    'recharge',
    'team-full-lottery',
    '队伍满员抽奖',
    '满员触发抽奖',
    { requires: ['login', 'teamInfo', 'lotteryConfig'], risk: 'high' },
  ],
  [
    'recharge',
    'team',
    '组队',
    '充值场景组队入口',
    { requires: ['login'], emits: ['team_open'] },
  ],
  [
    'redpacket',
    'redpacket-bounty',
    '赏金红包',
    '赏金任务红包',
    {
      requires: ['login', 'redpacketConfig'],
      risk: 'high',
      compliance: ['金额、风控与提现规则'],
    },
  ],
  [
    'redpacket',
    'redpacket-random',
    '随机红包',
    '随机金额红包',
    {
      requires: ['login', 'redpacketConfig'],
      risk: 'high',
      compliance: ['金额、风控与提现规则'],
    },
  ],
  [
    'redpacket',
    'redpacket-code-exchange',
    '红包口令兑换',
    '口令兑换红包',
    { requires: ['login', 'redpacketConfig'], risk: 'high' },
  ],
  [
    'redpacket',
    'redpacket-withdraw-records',
    '红包提现记录',
    '提现明细',
    {
      requires: ['login', 'withdrawRecords'],
      risk: 'high',
      compliance: ['隐私脱敏'],
    },
  ],
  [
    'redpacket',
    'redpacket-withdraw-progress',
    '提现任务进度',
    '提现任务进度条',
    { requires: ['login', 'withdrawStatus'], risk: 'high' },
  ],
  [
    'redpacket',
    'wallet',
    '我的钱包',
    '钱包总览',
    {
      requires: ['login', 'walletBalance'],
      risk: 'high',
      compliance: ['余额以后端为准'],
    },
  ],
  [
    'redpacket',
    'wallet-balance',
    '我的余额',
    '余额展示',
    {
      requires: ['login', 'walletBalance'],
      risk: 'high',
      compliance: ['余额以后端为准'],
    },
  ],
  [
    'redpacket',
    'wechat-bind',
    '账号绑定微信',
    '账号与微信绑定',
    { requires: ['login', 'wechatAuth'], emits: ['wechat_bind'], risk: 'high' },
  ],
  [
    'redpacket',
    'wechat-bind-button',
    '绑定微信按钮',
    '微信绑定操作',
    { requires: ['login', 'wechatAuth'], risk: 'high' },
  ],
  [
    'redpacket',
    'wechat-auth-guide',
    '微信授权指引',
    '微信授权流程指引',
    { requires: ['wechatAuth'], compliance: ['授权可撤回'] },
  ],
  [
    'reservation',
    'reserve-role-bind',
    '绑定角色-预创角',
    '预约预创角角色绑定',
    { requires: ['login'], risk: 'high' },
  ],
  [
    'reservation',
    'reserve-now',
    '立即预约',
    '预约主按钮',
    { requires: ['login'], emits: ['reservation_submit'], risk: 'medium' },
  ],
  [
    'reservation',
    'reserve-draw-count',
    '抽卡次数',
    '可抽次数展示',
    { requires: ['login', 'lotteryQuota'] },
  ],
  [
    'reservation',
    'reserve-card-draw',
    '预约抽卡',
    '预约奖励抽卡',
    {
      requires: ['login', 'lotteryConfig'],
      emits: ['reservation_lottery_draw'],
      risk: 'high',
    },
  ],
  [
    'reservation',
    'reserve-hero-pool',
    '英雄池-闪烁之光',
    '预约英雄池展示',
    { requires: ['heroPool'] },
  ],
  [
    'reservation',
    'server-open-time',
    '开服时间',
    '开服时间展示',
    { requires: ['serverConfig'] },
  ],
  [
    'reservation',
    'reserve-pre-recharge',
    '预充值',
    '预约期充值',
    {
      requires: ['login', 'paymentStatus'],
      emits: ['pre_recharge'],
      risk: 'high',
    },
  ],
  [
    'reservation',
    'reserve-pre-create-role',
    '预创角',
    '预约期创建角色',
    { requires: ['login'], emits: ['pre_create_role'], risk: 'high' },
  ],
  [
    'reservation',
    'reserve-milestone',
    '预约里程碑',
    '全服预约人数里程碑',
    { requires: ['reservationStats'] },
  ],
  [
    'reservation',
    'reserve-team',
    '组队（预约）',
    '新服预约组队入口',
    { requires: ['login'], emits: ['reservation_team_open'] },
  ],
  [
    'leaderboard',
    'leaderboard-task-completion',
    '任务完成排行榜',
    '任务完成度排行',
    { requires: ['leaderboardData'], compliance: ['隐私脱敏'] },
  ],
  [
    'private-domain',
    'lottery-task',
    '抽奖任务',
    '私域抽奖任务',
    { requires: ['login', 'lotteryConfig'], risk: 'high' },
  ],
  [
    'private-domain',
    'points-gift-pack',
    '积分礼包',
    '积分礼包',
    { requires: ['login', 'pointsBalance', 'rewardConfig'], risk: 'medium' },
  ],
  [
    'private-domain',
    'points-gift-pack-group',
    '积分礼包-分组',
    '分组积分礼包',
    { requires: ['login', 'pointsBalance', 'rewardConfig'], risk: 'medium' },
  ],
  [
    'card',
    'card-collection-subscribe',
    '集卡订阅消息',
    '集卡进度订阅提醒',
    { requires: ['login', 'wechatAuth'], emits: ['card_subscribe'] },
  ],
  [
    'card',
    'card-collection',
    '集卡',
    '集卡活动主玩法',
    { requires: ['login', 'cardConfig'], emits: ['card_collect'] },
  ],
  [
    'card',
    'card-transfer-records',
    '赠送/收取记录',
    '卡片赠收明细',
    { requires: ['login', 'cardRecords'] },
  ],
  [
    'spokesperson',
    'poster-generator',
    '生成海报',
    '代言海报生成',
    {
      requires: ['login', 'posterConfig'],
      emits: ['poster_generate'],
      risk: 'medium',
    },
  ],
  [
    'spokesperson',
    'spokesperson-leaderboard',
    '排行榜',
    '代言人气排行',
    { requires: ['leaderboardData'], compliance: ['隐私脱敏'] },
  ],
  [
    'ai-generated',
    'vote-remaining',
    '剩余可投票数',
    '剩余票数展示',
    { requires: ['login', 'voteQuota'] },
  ],
  [
    'ai-generated',
    'vote-list',
    '投票列表',
    'AI 生成内容投票',
    {
      requires: ['login', 'voteConfig'],
      emits: ['vote_submit'],
      risk: 'medium',
    },
  ],
  [
    'ai-generated',
    'vote-records',
    '投票记录',
    '个人投票明细',
    { requires: ['login', 'voteRecords'] },
  ],
];

export const PLAYWAY_COMPONENT_RULES: PlaywayComponentRule[] = entries.map(
  ([category, type, displayName, description, options]) =>
    rules(type, category, displayName, description, options),
);

export const PLAYWAY_COMPONENT_TYPES = PLAYWAY_COMPONENT_RULES.map(
  (item) => item.type,
);

export const PLAYWAY_ACTIVITY_TEMPLATES: PlaywayActivityTemplate[] = [
  {
    id: 'new-server-reservation-standard',
    activity: 'new-server-reservation',
    name: '新服预约标准模板',
    goal: '在开服前完成预约、预创角和奖励转化。',
    requiredComponents: ['banner', 'reserve-now', 'server-open-time', 'activity-rules'],
    optionalComponents: [
      'reserve-milestone',
      'reserve-card-draw',
      'reserve-draw-count',
      'reserve-pre-recharge',
      'reserve-pre-create-role',
      'reserve-team',
      'reserve-hero-pool',
      'reserve-role-bind',
    ],
    requiredApis: ['activityInfo', 'reservationStatus', 'reservationSubmit'],
    requiredEvents: ['activity_page_view', 'reservation_submit'],
    acceptanceChecks: [
      '活动关闭后不可预约。',
      '同一账号重复预约必须幂等。',
      '预创角和奖励资格必须以后端结果为准。',
    ],
    riskNotes: ['涉及角色绑定、预充值或抽卡时必须增加资格与资损校验。'],
  },
  {
    id: 'private-domain-acquisition-standard',
    activity: 'private-domain-acquisition',
    name: '私域拉新标准模板',
    goal: '通过社群和邀请裂变获取可归因的新用户。',
    requiredComponents: ['banner', 'community-link', 'task-invite', 'task-invite-poster'],
    optionalComponents: [
      'task-invite-progress',
      'invite-records',
      'wechat-subscribe',
      'redpacket-bounty',
      'lottery-grid',
      'points-gift-pack',
      'community-modal',
    ],
    requiredApis: ['activityInfo', 'inviteCode', 'inviteStats'],
    requiredEvents: ['activity_page_view', 'invite_share', 'invite_complete'],
    acceptanceChecks: [
      '邀请关系必须服务端归因，不能信任前端传入的邀请人数。',
      '重复设备、重复账号和异常频率必须进入反作弊分支。',
      '奖励发放和邀请记录必须可追溯。',
    ],
    riskNotes: ['红包、积分礼包和抽奖组合时需要增加套利与刷量风控。'],
  },
  {
    id: 'engagement-daily-loop',
    activity: 'engagement',
    name: '游戏促活日常任务模板',
    goal: '用登录、分享、充值和积分兑换形成日常活跃循环。',
    requiredComponents: ['banner', 'task-login-game', 'task-progress', 'task-daily-share'],
    optionalComponents: [
      'task-daily-recharge',
      'points-exchange',
      'card-collection',
      'daily-lottery',
      'lottery-wheel',
      'leaderboard-task-completion',
    ],
    requiredApis: ['activityInfo', 'taskStatus', 'rewardConfig'],
    requiredEvents: ['activity_page_view', 'game_login_complete', 'task_refresh'],
    acceptanceChecks: [
      '每日任务按自然日或活动时区正确重置。',
      '任务完成状态刷新后与服务端一致。',
      '积分兑换库存、次数和重复领取受到服务端约束。',
    ],
    riskNotes: ['充值任务必须校验支付回调，不能用前端成功态发奖。'],
  },
  {
    id: 'win-back-return-reward',
    activity: 'win-back',
    name: '游戏回流召回模板',
    goal: '识别流失用户并通过回归任务与奖励促成再次登录。',
    requiredComponents: ['banner', 'login', 'task-login-game', 'completion-toast'],
    optionalComponents: [
      'task-redpacket',
      'redpacket-random',
      'lottery-free',
      'my-rewards-list',
      'realname-verify',
      'customer-service',
    ],
    requiredApis: ['activityInfo', 'returnEligibility', 'taskStatus'],
    requiredEvents: ['activity_page_view', 'login_success', 'game_login_complete'],
    acceptanceChecks: [
      '非回流用户不可领取回流专属奖励。',
      '回流资格、奖励领取和过期时间必须可查询。',
      '完成任务后必须展示明确的奖励结果。',
    ],
    riskNotes: ['红包和抽奖奖励需要限制重复领取与账号批量套利。'],
  },
];

const normalize = (value: string) => value.toLowerCase().trim();

const compact = (value: string) => normalize(value).replace(/\s+/g, '');

export function searchPlaywayComponents(
  query: string,
  limit = 18,
): PlaywayComponentRule[] {
  const terms = normalize(query)
    .split(/[，。！？、\s,!?/]+/)
    .filter(Boolean);
  if (terms.length === 0) return PLAYWAY_COMPONENT_RULES.slice(0, limit);
  return PLAYWAY_COMPONENT_RULES.map((item) => ({
    item,
    score: terms.reduce((score, term) => {
      const haystack = compact(
        `${item.type}${item.displayName}${item.category}${item.description}${item.keywords.join('')}${item.activities.flatMap((activity) => ACTIVITY_LABELS[activity]).join('')}`,
      );
      return score + (haystack.includes(compact(term)) ? 2 : 0);
    }, 0),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.type.localeCompare(b.item.type))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function formatPlaywayRulesForPrompt(query: string): string {
  return searchPlaywayComponents(query)
    .map(
      (item) =>
        `${item.type}|${item.displayName}|需:${item.requires.join(',')}|配置:${item.configFields.join(',')}|事件:${item.emits.join(',')}|风险:${item.risk}|适用:${item.activities.join(',')}`,
    )
    .join('\n');
}

export function getPlaywayComponentRule(
  type: string,
): PlaywayComponentRule | undefined {
  return PLAYWAY_COMPONENT_RULES.find((item) => item.type === type);
}

export function searchPlaywayActivityTemplates(
  query: string,
  limit = 4,
): PlaywayActivityTemplate[] {
  const normalized = compact(query);
  if (!normalized) return PLAYWAY_ACTIVITY_TEMPLATES.slice(0, limit);
  return PLAYWAY_ACTIVITY_TEMPLATES.map((template) => ({
    template,
    score: [
      template.name,
      template.goal,
      template.activity,
      ...template.requiredComponents,
      ...template.optionalComponents,
      ...template.acceptanceChecks,
    ].reduce(
      (score, value) => score + (compact(value).includes(normalized) ? 2 : 0),
      0,
    ),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ template }) => template);
}

export function formatPlaywayTemplatesForPrompt(query: string): string {
  return searchPlaywayActivityTemplates(query)
    .map(
      (template) =>
        `${template.id}|${template.name}|必选:${template.requiredComponents.join(',')}|可选:${template.optionalComponents.join(',')}|接口:${template.requiredApis.join(',')}|埋点:${template.requiredEvents.join(',')}|验收:${template.acceptanceChecks.join('；')}`,
    )
    .join('\n');
}

export function buildPlaywayActivityGraph(query = ''): PlaywayActivityGraph {
  const templates = searchPlaywayActivityTemplates(query, 4);
  const nodes = new Map<string, { id: string; type: string; label: string }>();
  const edges: PlaywayActivityGraph['edges'] = [];
  const addNode = (id: string, type: string, label: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label });
  };
  for (const template of templates) {
    const activityId = `activity:${template.activity}`;
    addNode(activityId, 'activity', template.name);
    for (const componentType of [
      ...template.requiredComponents,
      ...template.optionalComponents,
    ]) {
      const rule = getPlaywayComponentRule(componentType);
      if (!rule) continue;
      const componentId = `component:${rule.type}`;
      addNode(componentId, 'component', rule.displayName);
      edges.push({ source: activityId, target: componentId, relation: 'uses' });
    }
    for (const api of template.requiredApis) {
      const apiId = `api:${api}`;
      addNode(apiId, 'api', api);
      edges.push({ source: activityId, target: apiId, relation: 'requires_api' });
    }
    for (const event of template.requiredEvents) {
      const eventId = `event:${event}`;
      addNode(eventId, 'event', event);
      edges.push({ source: activityId, target: eventId, relation: 'tracks' });
    }
  }
  return {
    nodes: [...nodes.values()],
    edges: edges.filter(
      (edge, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.source === edge.source &&
            candidate.target === edge.target &&
            candidate.relation === edge.relation,
        ) === index,
    ),
  };
}
