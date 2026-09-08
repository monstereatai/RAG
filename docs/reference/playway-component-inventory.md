# 游戏营销中台组件清单（pageSchema 组件词汇表）

> 来源：`playway/` 9 张低代码平台组件面板截图，OCR 提取（原文与截图对照见 [playway/README.md](../../playway/README.md)）。
> 用途：production workflow `lowCodeSchemas`（`kind: 'pageSchema'`）中 `components[].type` 的组件枚举参考——LLM 生成 Schema 时从这个词汇表取值，贴近真实营销中台语义；也可直接注入岗位 prompt（第五节紧凑格式）。
>
> **诚实声明**：截图仅含中文名，组件 ID 为本项目拟定的标准化命名（原平台内部标识未知，主人可按实际 ID 修正）；「通用组件」「页面框架」两组截图上无分类计数头，为整理时的整理分组。组件规则的机器可读版本见 `backend/src/modules/workflow/playway-component-registry.ts`。

## 一、分类总览

| 分类 | ID 风格 | 数量 | 来源 |
|---|---|---|---|
| 通用组件 | 无前缀 | 13 | 推断分组 |
| 页面框架 | 无前缀 | 10 | 推断分组 |
| 任务类 | `task-*` | 16 | 面板计数 (0/16) |
| 抽奖类 | `lottery-*` | 6 | 面板计数 (0/6) |
| 引流类 | `community-*` / `carousel` | 4 | 面板计数 (0/4) |
| 组队类 | `team-*` | 9 | 面板计数 (0/9) |
| 充值类 | `recharge-*` / 积分 | 6 | 面板计数 (0/6) |
| 红包类 | `redpacket-*` / `wechat-*` / `wallet*` | 10 | 面板计数 (0/10) |
| 新服预约类 | `reserve-*` / `server-*` | 10 | 面板计数 (0/10) |
| 排行榜类 | `leaderboard-*` | 1 | 面板计数 (0/1) |
| 私域窄口径类 | 积分/抽奖 | 3 | 面板计数 (0/3) |
| 集卡类 | `card-*` | 3 | 面板计数 (0/3) |
| 代言人类 | `poster-*` / `spokesperson-*` | 2 | 面板计数 (0/2) |
| AI 生成类 | `vote-*` | 3 | 面板计数 (0/3) |

合计 96 个组件。12 个有计数面板分类 + 通用/页面框架两组整理分组。运行时规则以 `playway-component-registry.ts` 为准。

## 二、组件明细

### 通用组件（13）

| ID | 中文名 | 说明 |
|---|---|---|
| `address-form` | 填写地址 | 收货/联系地址表单 |
| `role-bind` | 绑定角色（通用） | 账号与游戏角色绑定 |
| `role-bind-variant` | 绑定角色（变体） | 绑定角色的交互/样式变体 |
| `download-game-modal` | 下载游戏（弹出式） | 弹窗引导下载客户端 |
| `invite-records` | 邀请记录 | 邀请好友与奖励明细 |
| `login` | 登录 | 账号登录入口 |
| `login-overseas` | 海外登录 | 海外第三方账号登录 |
| `completion-toast` | 完成活动提示 | 任务完成反馈提示 |
| `instructions` | 说明 | 活动说明文案区 |
| `realname-verify` | 实名认证 | 防沉迷合规实名校验 |
| `my-rewards-table` | 我的奖励（表格） | 奖励明细，表格形态 |
| `my-rewards-list` | 我的奖励（列表） | 奖励明细，列表形态 |
| `activity-rules-modal` | 活动规则（弹出式） | 活动规则弹窗 |

### 页面框架（10）

| ID | 中文名 | 说明 |
|---|---|---|
| `banner` | Banner | 页头主视觉图 |
| `navbar` | 导航栏 | 顶部导航 |
| `tabbar` | Tabbar | 页签/底部导航 |
| `region-menu` | 地区菜单 | 多地区切换 |
| `language-menu` | 语言菜单 | 多语言切换 |
| `floating-gift` | 浮动礼包 | 悬浮礼包入口 |
| `activity-rules` | 活动规则 | 规则页/入口 |
| `task-rewards` | 任务奖励 | 任务奖励总览区 |
| `download-game` | 下载游戏 | 下载引导入口 |
| `customer-service` | 智齿客服 | 智齿客服会话入口 |

### 任务类（16）

| ID | 中文名 | 说明 |
|---|---|---|
| `task-countdown` | 任务倒计时 | 任务/活动剩余时间 |
| `task-progress` | 任务进度 | 总体任务进度 |
| `task-progress-bar` | 任务进度条 | 任务进度条展示 |
| `task-jump` | 跳转任务 | 跳转指定页面完成 |
| `task-login-game` | 登录游戏 | 登录游戏完成任务 |
| `task-daily-recharge` | 每日充值 | 每日充值任务 |
| `task-daily-share` | 每日分享 | 每日分享任务 |
| `task-mall-recharge` | 商城充值 | 商城充值任务 |
| `task-invite` | 邀请好友 | 邀请好友任务 |
| `task-invite-poster` | 邀请好友（海报） | 生成邀请海报分享 |
| `task-invite-progress` | 邀请好友进度条 | 邀请人数进度 |
| `task-qr-code` | 二维码任务 | 扫码任务 |
| `task-redpacket` | 红包任务 | 红包类任务 |
| `task-join-team` | 入队任务 | 加入队伍任务 |
| `task-refresh` | 刷新任务状态 | 手动刷新任务状态 |
| `wechat-subscribe` | 微信消息订阅 | 微信订阅消息授权 |

### 抽奖类（6）

| ID | 中文名 | 说明 |
|---|---|---|
| `lottery-grid` | 宫格抽奖 | 九宫格抽奖 |
| `lottery-wheel` | 转盘抽奖 | 大转盘抽奖 |
| `lottery-free` | 自由抽奖 | 免费次数抽奖 |
| `lottery-paid-tier` | 付费分层抽奖 | 按付费档位分层奖池 |
| `lottery-winner-carousel` | 中奖轮播 | 中奖结果轮播展示 |
| `lottery-winners` | 中奖名单 | 中奖用户公示 |

### 引流类（4）

| ID | 中文名 | 说明 |
|---|---|---|
| `carousel` | 轮播图 | 内容轮播 |
| `community-link` | 社群链接 | 社群跳转链接 |
| `community-link-entry` | 社群-链接 | 社群链接入口变体 |
| `community-modal` | 社群-弹出层 | 社群引导弹层 |

### 组队类（9）

| ID | 中文名 | 说明 |
|---|---|---|
| `team-create` | 创建队伍 | 创建组队 |
| `team-dissolve` | 解散队伍 | 解散组队 |
| `team-join` | 加入队伍 | 加入指定队伍 |
| `team-list` | 队伍列表 | 可加入队伍列表 |
| `team-info` | 队伍信息 | 队伍详情 |
| `team-points` | 队伍积分 | 队伍积分展示 |
| `team-invite` | 邀请组队 | 邀请好友组队 |
| `team-member-list` | 队伍成员列表 | 成员列表 |
| `team-members` | 队伍成员 | 成员展示卡片 |

### 充值类（6）

| ID | 中文名 | 说明 |
|---|---|---|
| `recharge-combo-tasks` | 结伴充值任务集 | 组队充值任务合集 |
| `recharge-cumulative-lottery` | 累计充值抽奖 | 累充档位抽奖 |
| `daily-lottery` | 每日抽奖 | 每日免费抽奖 |
| `points-exchange` | 积分兑换 | 积分商城兑换 |
| `team-full-lottery` | 队伍满员抽奖 | 满员触发抽奖 |
| `team` | 组队 | 充值场景组队入口 |

### 红包类（10）

| ID | 中文名 | 说明 |
|---|---|---|
| `redpacket-bounty` | 赏金红包 | 赏金任务红包 |
| `redpacket-random` | 随机红包 | 随机金额红包 |
| `redpacket-code-exchange` | 红包口令兑换 | 口令兑换红包 |
| `redpacket-withdraw-records` | 红包提现记录 | 提现明细 |
| `redpacket-withdraw-progress` | 提现任务进度 | 提现任务进度条 |
| `wallet` | 我的钱包 | 钱包总览 |
| `wallet-balance` | 我的余额 | 余额展示 |
| `wechat-bind` | 账号绑定微信 | 账号-微信绑定 |
| `wechat-bind-button` | 绑定微信按钮 | 绑定操作按钮 |
| `wechat-auth-guide` | 微信授权指引 | 授权流程指引 |

### 新服预约类（10）

| ID | 中文名 | 说明 |
|---|---|---|
| `reserve-now` | 立即预约 | 预约主按钮 |
| `reserve-pre-recharge` | 预充值 | 预约期充值 |
| `reserve-pre-create-role` | 预创角 | 预约期创建角色 |
| `reserve-card-draw` | 预约抽卡 | 预约奖励抽卡 |
| `reserve-draw-count` | 抽卡次数 | 可抽次数展示 |
| `reserve-milestone` | 预约里程碑 | 全服预约人数里程碑 |
| `server-open-time` | 开服时间 | 开服时间展示 |
| `reserve-hero-pool` | 英雄池-闪烁之光 | 游戏定制英雄池展示 |
| `reserve-role-bind` | 绑定角色-预约 | 预约场景角色绑定 |
| `reserve-team` | 组队（预约） | 新服预约组队入口 |

### 排行榜类（1）

| ID | 中文名 | 说明 |
|---|---|---|
| `leaderboard-task-completion` | 任务完成排行榜 | 任务完成度排行 |

### 私域窄口径类（3）

| ID | 中文名 | 说明 |
|---|---|---|
| `lottery-task` | 抽奖任务 | 私域抽奖任务 |
| `points-gift-pack` | 积分礼包 | 积分礼包 |
| `points-gift-pack-group` | 积分礼包-分组 | 分组积分礼包 |

### 集卡类（3）

| ID | 中文名 | 说明 |
|---|---|---|
| `card-collection` | 集卡 | 集卡活动主玩法 |
| `card-collection-subscribe` | 集卡订阅消息 | 集卡进度订阅提醒 |
| `card-transfer-records` | 赠送/收取记录 | 卡片赠收明细 |

### 代言人类（2）

| ID | 中文名 | 说明 |
|---|---|---|
| `poster-generator` | 生成海报 | 代言海报生成 |
| `spokesperson-leaderboard` | 排行榜 | 代言人气排行 |

### AI 生成类（3）

| ID | 中文名 | 说明 |
|---|---|---|
| `vote-list` | 投票列表 | AI 生成内容投票 |
| `vote-records` | 投票记录 | 个人投票明细 |
| `vote-remaining` | 剩余可投票数 | 剩余票数展示 |

## 三、活动类型 → 组件组合建议（推断，供 pageSchema 生成参考）

| 活动类型 | 推荐组件组合（示例，非权威） |
|---|---|
| 新服预约活动 | `banner` `reserve-now` `reserve-milestone` `reserve-card-draw` `reserve-draw-count` `server-open-time` `reserve-pre-recharge` `reserve-pre-create-role` `reserve-hero-pool` `download-game` `activity-rules-modal` `my-rewards-list` |
| 私域拉新活动 | `carousel` `community-link` `community-modal` `task-invite-poster` `task-invite-progress` `wechat-subscribe` `redpacket-bounty` `wechat-bind` `lottery-grid` `my-rewards-list` |
| 游戏促活活动 | `task-daily-recharge` `task-daily-share` `task-login-game` `task-progress` `points-exchange` `card-collection` `lottery-wheel` `daily-lottery` `leaderboard-task-completion` |
| 游戏回流活动 | `task-login-game` `task-redpacket` `redpacket-random` `lottery-free` `realname-verify` `login` `completion-toast` `my-rewards-list` |

## 四、pageSchema 使用示例

与 production workflow 现有 Schema 形状（`production-workflow.service.ts` roleSchema 的 `components[].type`）对齐：

```json
{
  "schemaVersion": 1,
  "kind": "pageSchema",
  "title": "新服预约页结构",
  "components": [
    { "id": "hero", "type": "banner", "name": "主视觉" },
    { "id": "milestone", "type": "reserve-milestone", "name": "预约里程碑" },
    { "id": "reserve", "type": "reserve-now", "name": "立即预约" },
    { "id": "opentime", "type": "server-open-time", "name": "开服时间" }
  ]
}
```

## 五、Prompt 注入用紧凑格式

直接粘贴进岗位 prompt（如 roleSchema 生成提示）即可约束组件词汇：

```text
组件词汇表（components[].type 仅可取以下值）：
通用: address-form(填写地址) role-bind(绑定角色) role-bind-variant(绑定角色变体) download-game-modal(下载游戏弹窗) invite-records(邀请记录) login(登录) login-overseas(海外登录) completion-toast(完成提示) instructions(说明) realname-verify(实名认证) my-rewards-table(我的奖励表格) my-rewards-list(我的奖励列表) activity-rules-modal(活动规则弹窗)
框架: banner(主视觉) navbar(导航栏) tabbar(页签导航) region-menu(地区菜单) language-menu(语言菜单) floating-gift(浮动礼包) activity-rules(活动规则) task-rewards(任务奖励区) download-game(下载游戏) customer-service(智齿客服)
任务: task-countdown(任务倒计时) task-invite-progress(邀请进度条) task-jump(跳转任务) task-daily-recharge(每日充值) task-daily-share(每日分享) task-invite-poster(邀请海报) task-invite(邀请好友) task-login-game(登录游戏) task-mall-recharge(商城充值) task-qr-code(二维码任务) task-redpacket(红包任务) task-join-team(入队任务) wechat-subscribe(微信订阅) task-refresh(刷新任务状态) task-progress(任务进度) task-progress-bar(任务进度条)
抽奖: lottery-grid(宫格抽奖) lottery-wheel(转盘抽奖) lottery-free(自由抽奖) lottery-paid-tier(付费分层抽奖) lottery-winner-carousel(中奖轮播) lottery-winners(中奖名单)
引流: carousel(轮播图) community-link(社群链接) community-link-entry(社群链接入口) community-modal(社群弹层)
组队: team-create(创建队伍) team-dissolve(解散队伍) team-join(加入队伍) team-list(队伍列表) team-info(队伍信息) team-points(队伍积分) team-invite(邀请组队) team-member-list(成员列表) team-members(队伍成员)
充值: recharge-combo-tasks(结伴充值任务集) recharge-cumulative-lottery(累充抽奖) daily-lottery(每日抽奖) points-exchange(积分兑换) team-full-lottery(满员抽奖) team(组队)
红包: redpacket-bounty(赏金红包) redpacket-random(随机红包) redpacket-code-exchange(口令兑换) redpacket-withdraw-records(提现记录) redpacket-withdraw-progress(提现进度) wallet(我的钱包) wallet-balance(我的余额) wechat-bind(绑定微信) wechat-bind-button(绑定按钮) wechat-auth-guide(授权指引)
新服预约: reserve-role-bind(绑定角色-预创角) reserve-now(立即预约) reserve-draw-count(抽卡次数) reserve-card-draw(预约抽卡) reserve-hero-pool(英雄池) server-open-time(开服时间) reserve-pre-recharge(预充值) reserve-pre-create-role(预创角) reserve-milestone(预约里程碑) reserve-team(组队)
排行榜: leaderboard-task-completion(任务完成排行榜)
私域: lottery-task(抽奖任务) points-gift-pack(积分礼包) points-gift-pack-group(分组礼包)
集卡: card-collection(集卡) card-collection-subscribe(集卡订阅) card-transfer-records(赠送收取记录)
代言人: poster-generator(生成海报) spokesperson-leaderboard(代言排行)
AI生成: vote-list(投票列表) vote-records(投票记录) vote-remaining(剩余票数)
```
