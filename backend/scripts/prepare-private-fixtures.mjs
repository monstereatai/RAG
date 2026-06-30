/**
 * prepare-private-fixtures.mjs
 *
 * 生成脱敏的私有企业模拟数据集，用于本地严格校验和端到端评测链路验证。
 * 所有数据均为通用行业模拟，不包含任何真实公司私密信息。
 *
 * 替代真实私密样本时保持同一 schema，仅替换 content/text 字段。
 *
 * 用法:
 *   node scripts/prepare-private-fixtures.mjs         # 生成所有 fixture
 *   node scripts/prepare-private-fixtures.mjs --check  # 仅校验现有 fixture
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const rootDir = resolve(new URL('..', import.meta.url).pathname);
const fixturesDir = resolve(rootDir, 'eval/private-fixtures');
const docsDir = resolve(fixturesDir, 'documents');
const mediaDir = resolve(fixturesDir, 'media');
const checkOnly = process.argv.includes('--check');

const files = {
  businessDataset: resolve(rootDir, 'eval/private-business-regression.dataset.json'),
  multimodalDataset: resolve(rootDir, 'eval/private-multimodal.dataset.json'),
  graphSeed: resolve(rootDir, 'eval/private-graph-business.seed.json'),
  organization: resolve(rootDir, 'eval/private-organization.fixture.json'),
};

if (checkOnly) {
  await checkFixtures();
} else {
  await prepareFixtures();
}

/* ================================================================
 *  Fixture preparation
 * ================================================================ */

async function prepareFixtures() {
  await mkdir(docsDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });

  const documentFiles = buildDocumentFiles();
  for (const [filename, content] of Object.entries(documentFiles)) {
    await writeFile(resolve(docsDir, filename), content);
  }

  await writeFile(resolve(mediaDir, 'meeting-action-items.wav'), makeSilentWav(1));
  await writeFile(resolve(mediaDir, 'dashboard-screenshot.png'), makeMinimalPng());
  await writeFile(resolve(mediaDir, 'approval-training.mp4'), makeMinimalMp4());

  await writeFile(files.businessDataset, JSON.stringify(makeBusinessDataset(), null, 2) + '\n');
  await writeFile(files.multimodalDataset, JSON.stringify(makeMultimodalDataset(), null, 2) + '\n');
  await writeFile(files.graphSeed, JSON.stringify(makeGraphSeed(), null, 2) + '\n');
  await writeFile(files.organization, JSON.stringify(makeOrganizationFixture(), null, 2) + '\n');

  await checkFixtures();
}

/* ================================================================
 *  Document file builders
 * ================================================================ */

function buildDocumentFiles() {
  return {
    // ── HR documents ──────────────────────────────────────────────
    'hr-travel-policy-2026.md': `# 2026 年度差旅管理制度（v2.1）

> 版本：2.1 | 生效日期：2026-01-01 | 审批人：财务负责人
> 历史版本：v2.0 (2025-01-01) 住宿标准不同，见冲突说明

## 一、住宿标准

| 城市等级 | 住宿报销上限（元/晚） |
|---------|-------------------|
| 一线城市（北上广深） | 650 |
| 二线城市（省会及计划单列市） | 480 |
| 三线及以下城市 | 320 |

> ⚠️ **版本冲突**：2025 版（v2.0）规定一线城市上限为 600 元，
> 二线城市为 450 元。2026 版优先生效。

## 二、交通标准

- 高铁：二等座不限金额，一等座需总监级及以上审批
- 飞机：经济舱不限，公务舱需 VP 级及以上审批
- 网约车：每日上限 200 元，超出部分自付

## 三、报销时效

费用必须在发票开具后 **30 天内**提交报销系统。
超过 30 天需要部门负责人补充审批说明，超过 60 天不予报销。

## 四、伙食补贴

- 国内出差：每日 150 元（无需发票）
- 国际出差：每日 300 元（无需发票）
- 客户宴请：需单独提交招待申请，人均不超过 500 元
`,
    'hr-annual-leave.md': `# 年假管理制度（2026 版）

> 生效日期：2026-01-01 | 适用范围：全员

## 年假额度

| 工龄区间 | 年假天数 |
|---------|---------|
| 1-3 年 | 5 天 |
| 4-7 年 | 10 天 |
| 8 年以上 | 15 天 |

## 年假使用规则

1. 年假按自然年计算，当年未休完可结转最多 5 天至次年
2. 连续休假超过 5 天需部门负责人审批
3. 离职时未休年假按日工资 300% 折算补偿
4. 年假不可兑换现金（离职补偿除外）

## 事假规则

- 事假全年累计不超过 20 天
- 超过 3 天的事假需 VP 级审批
- 事假期间无薪
`,
    // ── Finance documents ─────────────────────────────────────────
    'finance-expense-sop.md': `# 费用报销标准操作流程（SOP）

> 版本：3.0 | 最后更新：2026-03-15 | 负责部门：财务部

## 一、报销类型与材料

### 1.1 差旅报销
- 必备材料：机票/车票行程单、酒店发票、出差申请单
- 线上提交：企业微信 → 审批 → 财务 → 打款

### 1.2 招待费报销
- 必备材料：发票、招待申请单、参与人员名单
- 人均超过 500 元需提前申请 VP 审批

### 1.3 办公采购
- 单笔不超过 5,000 元：部门负责人审批
- 单笔 5,000-50,000 元：财务负责人 + 部门负责人双签
- 单笔超过 50,000 元：需 VP 审批 + 采购部介入

## 二、审批时效

- 普通报销：提交后 7 个工作日内审批完成
- 加急报销：标注"加急"后 2 个工作日内审批完成
- 跨月报销：必须在上月关账后 5 个工作日内提交

## 三、常见退单原因

1. 发票抬头错误（必须为全称）
2. 缺少对应审批单
3. 金额与审批不符
4. 超过报销时效（60 天）
`,
    'finance-budget-policy.md': `# 年度预算管理制度

> 版本：2.0 | 生效：2026-01-01 | 类型：公司级制度

## 一、预算周期

- 预算编制：每年 9 月启动，12 月完成审批
- 年中调整：每年 6 月可申请一次预算调整
- 紧急追加：需 CEO 审批，年度不超过 2 次

## 二、审批权限

| 金额区间 | 审批人 |
|---------|-------|
| 50 万以下 | 部门负责人 |
| 50 万 - 200 万 | 财务负责人 + 部门负责人 |
| 200 万 - 500 万 | VP + 财务负责人 |
| 500 万以上 | CEO |

## 三、预算纪律

- 超预算支出需提前申请追加，不得先斩后奏
- 部门预算执行率低于 60% 的，次年预算缩减 10%
- 预算内结余可结转至次年，上限为原预算的 20%
`,
    // ── Legal documents ───────────────────────────────────────────
    'legal-contract-workflow.md': `# 合同审批及签署管理制度

> 版本：4.0 | 生效：2026-04-01

## 一、合同分类

### A 类（标准合同）
金额 10 万元以下，使用法务部标准模板，部门负责人签署即可。

### B 类（一般合同）
金额 10 万至 50 万元，需法务复核。

### C 类（重大合同）
金额超过 50 万元，需要法务复核和财务复核，**缺一不可**。
涉及关联交易的，还需合规委员会审批。

## 二、合同签署

- 电子签章与纸质签章具有同等法律效力
- 合同签署后 3 个工作日内归档至法务部
- 合同变更需签署补充协议，变更幅度超过 30% 视为新合同

## 三、供应商合同特殊要求

- 新供应商准入必须提供营业执照、对公账户证明和近一年合规承诺书
- 缺少任一材料不得建档
- 合同到期前 30 天启动续签流程
`,
    'legal-data-privacy-policy.md': `# 数据隐私合规政策

> 版本：1.0 | 生效：2026-01-01 | 参考法规：个人信息保护法

## 一、个人数据分类

- **敏感个人信息**：身份证号、手机号、银行卡号、生物识别信息
- **一般个人信息**：姓名、工号、部门、职位
- **工作联系信息**：企业邮箱、办公电话

## 二、数据处理规则

1. 敏感个人信息导出前必须完成数据脱敏和安全审批
2. 个人数据存储期限不超过业务必要期限 + 180 天
3. 员工离职后 30 天内删除或匿名化所有个人数据
4. 第三方数据共享必须签署 DPA（数据处理协议）

## 三、数据主体权利响应

- 数据查阅请求：15 个工作日内响应
- 数据删除请求：30 个工作日内完成
- 拒绝处理：需法务部书面意见
`,
    // ── IT / Security documents ───────────────────────────────────
    'it-access-control.md': `# 信息访问控制与权限管理制度

> 版本：3.1 | 生效：2026-02-01

## 一、权限生命周期

### 1.1 权限申请
- 员工入职后由直属主管在 IT 系统中提交权限申请
- 默认生产系统权限有效期为 **90 天**
- 超过 90 天需重新提交申请并经过直属主管审批

### 1.2 权限变更
- 岗位变动后 48 小时内更新权限
- 离职员工权限在离职当日 18:00 统一回收

### 1.3 权限审计
- 每季度进行一次权限复核
- 发现僵尸账号（连续 30 天未登录）自动冻结
`,
    'security-incident-response.md': `# 安全事件响应制度

> 版本：2.0 | 生效：2026-01-01

## 一、事件分级

| 级别 | 定义 | 响应时间 |
|------|------|---------|
| P1 | 数据泄露、核心服务中断 | 15 分钟内响应 |
| P2 | 服务降级、安全告警 | 30 分钟内响应 |
| P3 | 低风险告警、合规提醒 | 4 小时内响应 |

## 二、响应流程

1. **P1 故障**：15 分钟内确认响应 → 2 小时内提交初步复盘 → 3 个工作日内提交正式复盘
2. **P2 故障**：30 分钟内确认 → 4 小时内定位 → 5 个工作日内复盘
3. 所有安全事件必须通过安全事件管理平台记录

## 三、升级机制

- P1 事件自动通知安全负责人和值班经理
- 事件处置超过 1 小时未解决，升级至安全部门负责人
- 超过 4 小时未解决，升级至 CISO
`,
    // ── Sales documents ───────────────────────────────────────────
    'sales-deal-desk-playbook.md': `# Deal Desk 标准运营手册

> 版本：2.2 | 生效：2026-05-01

## 一、折扣审批矩阵

| 折扣区间 | 审批人 | 备注 |
|---------|-------|------|
| 9.5 折及以上 | 销售代表自签 | 标准报价 |
| 8.1 折 - 9.4 折 | 销售总监 | 需备注竞争信息 |
| 8 折及以内 | 销售总监审批 | 标准折扣权限上限 |
| 低于 8 折 | Deal Desk 评审 | 需法务和财务确认 |

## 二、Deal Desk 评审要求

低于 8 折必须提交 Deal Desk 评审，评审内容包括：
1. 客户价值分析（CLV > 合同金额 3 倍）
2. 竞争情况说明（至少 1 家竞品）
3. 法务风险确认
4. 财务利润模型（毛利率不低于 20%）

## 三、特别折扣

- 战略客户（年合同额 > 500 万）：可申请额外 5% 折扣
- 公益组织：在标准折扣基础上额外 10%
`,
    // ── Ops documents ─────────────────────────────────────────────
    'ops-incident-runbook.md': `# 故障应急响应 Runbook

> 版本：4.0 | 生效：2026-03-01

## 一、故障等级定义

| 等级 | 影响范围 | MTTR 目标 |
|------|---------|----------|
| P0 | 全站不可用 | < 15 分钟 |
| P1 | 核心功能不可用 | < 2 小时 |
| P2 | 非核心功能降级 | < 8 小时 |
| P3 | 视觉/体验问题 | < 24 小时  |

## 二、响应 SLO

- P0：5 分钟响应，10 分钟定位
- P1：15 分钟响应，2 小时提交初步复盘，3 个工作日内正式复盘
- 线上故障禁止直接修改数据库

## 三、复盘要求

- 5W1H 分析（What/Where/When/Who/Why/How）
- 故障根因必须定位到代码 commit 或配置变更
- 行动项必须有 owner 和 deadline
- 复盘文档存档至 wiki

## 四、值班制度

- 每日 9:00-21:00 一线值班，21:00-9:00 二线值班
- 值班人员不得同时参与开发任务
`,
    // ── Product documents ─────────────────────────────────────────
    'product-release-process.md': `# 产品发布管理流程

> 版本：3.0 | 生效：2026-04-01

## 一、发布类型

| 类型 | 频率 | 审批人 |
|------|------|-------|
| 大版本（vX.0） | 季度 | VP Product |
| 小版本（vX.Y） | 双周 | PM Lead |
| Hotfix | 按需 | 值班经理 |

## 二、灰度发布策略

1. **第一阶段**：内部员工（至少 4 小时）
2. **第二阶段**：5% 外部用户（24 小时观察）
3. **第三阶段**：25% 外部用户（12 小时观察）
4. **第四阶段**：全量发布

核心指标（错误率、性能、转化率）稳定 24 小时后才能扩大流量。
任一阶段指标异常立即回滚。

## 三、发布检查清单

- [ ] 自动化测试通过（覆盖率 ≥ 80%）
- [ ] 安全扫描通过
- [ ] 变更日志已更新
- [ ] 灰度计划已审批
- [ ] 回滚方案就绪
`,
    // ── Customer Success documents ─────────────────────────────────
    'customer-success-sla-v2.md': `# 客户服务等级协议（SLA v2）

> 版本：2.0 | 生效：2026-06-01
> ⚠️ v1.0（2025-01-01 生效）规定企业版一级工单在 2 小时内首次响应，
> v2.0 已更新为 1 小时内。v2.0 优先生效。

## 一、工单分级

| 级别 | 定义 | 示例 |
|------|------|------|
| P1（紧急） | 核心功能不可用，业务中断 | 登录失败、无法下单 |
| P2（高） | 功能严重降级 | 页面加载超过 10s |
| P3（中） | 功能部分异常 | 某个字段显示错误 |
| P4（低） | 咨询/建议 | 功能使用咨询 |

## 二、SLA 承诺

### 企业版客户
| 工单级别 | 首次响应 | 解决时间 | 备注 |
|---------|---------|---------|------|
| P1 | 1 小时内 | 4 小时内 | ⚠️ 对比 v1.0 有变化 |
| P2 | 2 小时内 | 8 小时内 | |
| P3 | 4 小时内 | 24 小时内 | |
| P4 | 8 小时内 | 48 小时内 | |

### 普通版客户
| 工单级别 | 首次响应 | 解决时间 |
|---------|---------|---------|
| P1 | 4 小时内 | 8 小时内 |
| P2 | 8 小时内 | 24 小时内 |
| P3 | 12 小时内 | 48 小时内 |
| P4 | 24 小时内 | 72 小时内 |

## 三、升级路径

- P1 工单 1 小时未解决 → 值班经理介入
- P2 工单 4 小时未更新 → 客户成功负责人关注
- P1 工单 2 小时未解决 → 协调研发团队处理

## 四、SLA 例外

- 不可抗力（自然灾害、大规模网络中断）不计入 SLA
- 客户未按要求提供信息时，计时暂停
`,
    // ── Procurement documents ─────────────────────────────────────
    'procurement-supplier-policy.md': `# 供应商全生命周期管理制度

> 版本：2.1 | 生效：2026-02-01

## 一、供应商准入

新供应商准入必须提供以下材料，缺一不可：
1. 营业执照（副本复印件加盖公章）
2. 对公账户证明
3. 近一年合规承诺书
4. 法定代表人身份证明

## 二、供应商分级

| 等级 | 年采购额 | 评审频率 | 付款账期 |
|------|---------|---------|---------|
| S 级 | > 500 万 | 半年一次 | 30 天 |
| A 级 | 100 万 - 500 万 | 一年一次 | 45 天 |
| B 级 | 10 万 - 100 万 | 一年一次 | 60 天 |
| C 级 | < 10 万 | 抽查 | 90 天 |

## 三、合同要求

- 采购合同超过 50 万元时，需要法务复核和财务复核
- 年度框架合同无需逐笔审批
`,
    // ── Data governance ───────────────────────────────────────────
    'data-governance-metrics.md': `# 数据治理与指标口径规范

> 版本：1.5 | 生效：2026-01-01

## 一、核心指标口径

### 1.1 月活用户（MAU）
统计自然月内至少登录一次的去重用户，**不包含测试账号和内部压测账号**。

### 1.2 收入确认
- SaaS 订阅收入：按服务期间线性确认
- 专业服务收入：按交付里程碑确认
- 禁止提前确认未交付收入

### 1.3 客户留存率
- 月留存：当月活跃/上月活跃 × 100%
- 年留存：当年有付费记录/上年有付费记录 × 100%

## 二、数据质量要求

- 核心字段缺失率 < 1%
- 数据延迟不超过 15 分钟
- 指标定义变更需数据治理委员会审批
`,
  };
}

/* ================================================================
 *  Business regression dataset (50 → 120+ items)
 * ================================================================ */

function makeBusinessDataset() {
  // Each domain has one base fact; the script generates variants
  const domains = buildDomains();
  const prefixes = [
    '按制度回答：',            // standard
    '只基于知识库回答：',       // grounding
    '不要猜，查一下：',         // grounding variant
    '审批前确认：',             // approval context
    '给我可引用结论：',         // citation emphasis
    '业务同学问：',             // business context
  ];

  // Build normal QA items (prefix variants for each domain)
  const items = [];
  let ordinal = 0;

  for (let di = 0; di < domains.length; di++) {
    const domain = domains[di];
    const domainTag = `${domain.department}-${domain.documentType}`;
    for (let pIdx = 0; pIdx < prefixes.length; pIdx++) {
      ordinal++;
      const prefix = prefixes[pIdx];
      items.push({
        id: `pv-${domainTag}-${String(pIdx + 1).padStart(2, '0')}`,
        category: pIdx === 2 ? 'poison-grounding' : 'private-business-qa',
        department: domain.department,
        documentType: domain.documentType,
        query: `${prefix}${domain.ask}`,
        referenceAnswer: domain.answer,
        referenceReferences: [{ id: `pv-${domainTag}-${String(pIdx + 1).padStart(2, '0')}-ref` }],
        expectedClaims: [
          {
            text: domain.cleanAnswer,
            supportKeywords: domain.keywords,
          },
        ],
        expectedKeywords: domain.keywords,
        minKeywordCoverage: Math.min(1, 2 / domain.keywords.length),
        requireCitation: true,
        sourceDocument: {
          id: `pv-doc-${domainTag}`,
          title: domain.docTitle,
          content: domain.fact,
          referenceIndex: 1,
        },
        ordinal,
      });
    }
  }

  // ── Conflict scenarios ────────────────────────────────────────
  const conflicts = [
    {
      id: 'pv-conflict-travel-01',
      category: 'policy-conflict',
      department: 'hr',
      documentType: 'policy',
      query: '按制度回答：2025 版差旅制度一线城市住宿报销上限是多少？',
      referenceAnswer: '2025 版差旅制度规定一线城市住宿报销上限为 600 元，但 2026 版已更新为 650 元，2026 版优先生效。[片段1][片段2]',
      referenceReferences: [{ id: 'pv-conflict-travel-01-ref' }],
      expectedClaims: [
        { text: '2025 版差旅制度规定一线城市住宿报销上限为 600 元', supportKeywords: ['2025', '600 元'] },
        { text: '2026 版已更新为 650 元，2026 版优先生效', supportKeywords: ['2026', '650 元', '优先生效'] },
      ],
      expectedKeywords: ['2025', '600 元', '2026', '650 元'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      expectConflictHandling: true,
      sourceDocument: {
        id: 'pv-doc-hr-travel-conflict',
        title: '差旅制度版本冲突说明',
        content: '2025 版（v2.0）规定一线城市住宿报销上限为 600 元，2026 版已更新为 650 元。版本冲突时以最新版本为准，2026 版优先生效。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
    {
      id: 'pv-conflict-sla-01',
      category: 'policy-conflict',
      department: 'customer-success',
      documentType: 'sla',
      query: '按制度回答：企业版客户一级工单多久内首次响应？注意检查不同版本。',
      referenceAnswer: 'v2.0 规定企业版客户 P1 工单 1 小时内首次响应。此前 v1.0 规定为 2 小时，v2.0 优先生效。[片段1][片段2]',
      referenceReferences: [{ id: 'pv-conflict-sla-01-ref' }],
      expectedClaims: [
        { text: 'v2.0 规定企业版客户 P1 工单 1 小时内首次响应', supportKeywords: ['v2.0', '1 小时'] },
        { text: 'v1.0 规定为 2 小时', supportKeywords: ['v1.0', '2 小时'] },
      ],
      expectedKeywords: ['v2.0', '1 小时', 'v1.0', '2 小时'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      expectConflictHandling: true,
      sourceDocument: {
        id: 'pv-doc-cs-sla-conflict',
        title: 'SLA 版本冲突说明',
        content: 'v1.0 规定企业版 P1 工单 2 小时内首次响应，v2.0 已更新为 1 小时。版本冲突时以最新版本为准。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
    {
      id: 'pv-conflict-discount-01',
      category: 'policy-conflict',
      department: 'sales',
      documentType: 'deal-desk',
      query: '按制度回答：低于 8 折的客户折扣怎么审批？涉及哪些部门？',
      referenceAnswer: '低于 8 折的客户折扣必须提交 Deal Desk 评审。评审内容包括法务风险确认和财务利润模型（毛利率不低于 20%）。[片段1][片段2]',
      referenceReferences: [{ id: 'pv-conflict-discount-01-ref' }],
      expectedClaims: [
        { text: '低于 8 折必须提交 Deal Desk 评审', supportKeywords: ['8 折', 'Deal Desk'] },
        { text: '需要法务风险确认和财务利润模型', supportKeywords: ['法务', '财务', '毛利率'] },
      ],
      expectedKeywords: ['Deal Desk', '法务', '财务', '8 折'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      crossDepartment: true,
      sourceDocument: {
        id: 'pv-doc-sales-deal-cross',
        title: '折扣审批跨部门流程',
        content: '低于 8 折的客户折扣必须提交 Deal Desk 评审，评审需法务确认风险和财务确认利润模型（毛利率不低于 20%）。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
    {
      id: 'pv-conflict-incident-01',
      category: 'policy-consistency',
      department: 'ops',
      documentType: 'incident-sop',
      query: '按制度回答：P1 故障需要在多长时间内响应和复盘？',
      referenceAnswer: 'P1 故障必须在 15 分钟内响应，2 小时内提交初步复盘，3 个工作日内提交正式复盘。[片段1]',
      referenceReferences: [{ id: 'pv-conflict-incident-01-ref' }],
      expectedClaims: [
        { text: 'P1 故障 15 分钟内响应', supportKeywords: ['15 分钟', '响应'] },
        { text: '2 小时内提交初步复盘，3 个工作日内正式复盘', supportKeywords: ['2 小时', '初步复盘', '3 个工作日', '正式复盘'] },
      ],
      expectedKeywords: ['15 分钟', '2 小时', '3 个工作日', '初步复盘', '正式复盘'],
      minKeywordCoverage: 0.6,
      requireCitation: true,
      sourceDocument: {
        id: 'pv-doc-ops-incident',
        title: '故障应急响应制度',
        content: 'P1 故障必须在 15 分钟内响应，2 小时内提交初步复盘，3 个工作日内提交正式复盘。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
  ];
  items.push(...conflicts);

  // ── Refusal scenarios (questions outside knowledge base) ──────
  const refusals = [
    {
      id: 'pv-refusal-personal-01',
      category: 'refusal',
      department: 'general',
      documentType: 'general',
      query: '帮我写一份竞品分析报告，对比最近三个季度的市场份额变化。',
      referenceAnswer: '知识库中未包含竞品分析报告或市场份额数据，无法回答此问题。',
      referenceReferences: [{ id: 'pv-refusal-personal-01-ref' }],
      expectedClaims: [
        { text: '知识库中未包含竞品分析报告', supportKeywords: ['未包含', '竞品分析'] },
      ],
      expectedKeywords: ['未包含', '知识库'],
      minKeywordCoverage: 0.5,
      requireCitation: false,
      expectRefusal: true,
      ordinal: ++ordinal,
    },
    {
      id: 'pv-refusal-stock-01',
      category: 'refusal',
      department: 'general',
      documentType: 'general',
      query: '今天公司股价是多少？最近有什么利好消息？',
      referenceAnswer: '知识库中没有股票价格或市场信息，无法回答此问题。',
      referenceReferences: [{ id: 'pv-refusal-stock-01-ref' }],
      expectedClaims: [
        { text: '知识库中没有股票价格', supportKeywords: ['股票', '知识库'] },
      ],
      expectedKeywords: ['知识库', '没有'],
      minKeywordCoverage: 0.5,
      requireCitation: false,
      expectRefusal: true,
      ordinal: ++ordinal,
    },
    {
      id: 'pv-refusal-outside-01',
      category: 'refusal',
      department: 'general',
      documentType: 'general',
      query: '帮我预约后天的会议室，20 人以上，需要投影和白板。',
      referenceAnswer: '知识库中不包含会议室实时预订信息，无法执行预订操作。建议手动通过企业微信预订。',
      referenceReferences: [{ id: 'pv-refusal-outside-01-ref' }],
      expectedClaims: [
        { text: '不包含会议室实时预订信息', supportKeywords: ['会议室', '预订'] },
      ],
      expectedKeywords: ['会议室', '预订', '操作'],
      minKeywordCoverage: 0.4,
      requireCitation: false,
      expectRefusal: true,
      ordinal: ++ordinal,
    },
    {
      id: 'pv-refusal-personal-02',
      category: 'refusal',
      department: 'general',
      documentType: 'general',
      query: '你觉得 AI 会取代程序员吗？给我一个客观的分析。',
      referenceAnswer: '知识库中没有关于 AI 行业趋势或职业发展的信息，无法回答此问题。请基于知识库内容提问。',
      referenceReferences: [{ id: 'pv-refusal-personal-02-ref' }],
      expectedClaims: [
        { text: '知识库中没有关于 AI 行业趋势的信息', supportKeywords: ['AI', '行业趋势', '知识库'] },
      ],
      expectedKeywords: ['知识库', '没有'],
      minKeywordCoverage: 0.4,
      requireCitation: false,
      expectRefusal: true,
      ordinal: ++ordinal,
    },
  ];
  items.push(...refusals);

  // ── Cross-department scenario ─────────────────────────────────
  const crossDept = [
    {
      id: 'pv-cross-contract-01',
      category: 'cross-department',
      department: 'legal',
      documentType: 'contract-guideline',
      query: '请按制度回答：超过 50 万元的采购合同有哪些审批环节？涉及哪些部门？',
      referenceAnswer: '采购合同超过 50 万元时，需要法务复核和财务复核，缺一不可。采购负责人提交合同后，法务负责人确认条款风险，财务负责人确认预算。[片段1][片段2]',
      referenceReferences: [{ id: 'pv-cross-contract-01-ref' }],
      expectedClaims: [
        { text: '需要法务复核和财务复核', supportKeywords: ['法务复核', '财务复核'] },
        { text: '法务负责人确认条款风险', supportKeywords: ['法务负责人', '条款风险'] },
        { text: '财务负责人确认预算', supportKeywords: ['财务负责人', '预算'] },
      ],
      expectedKeywords: ['法务复核', '财务复核', '法务负责人', '财务负责人', '预算'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      crossDepartment: true,
      sourceDocument: {
        id: 'pv-doc-legal-cross-contract',
        title: '合同审批跨部门协作',
        content: '超过 50 万元的采购合同需要法务复核和财务复核。法务负责人确认条款风险，财务负责人确认预算。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
    {
      id: 'pv-cross-security-01',
      category: 'cross-department',
      department: 'security',
      documentType: 'data-policy',
      query: '按制度回答：高敏感数据导出需要哪些审批？哪些部门参与？',
      referenceAnswer: '身份证号、手机号、银行卡号属于高敏感数据。高敏感数据导出前必须完成数据脱敏和安全审批。安全团队负责安全审批，数据所属部门负责人确认导出必要性。[片段1][片段2]',
      referenceReferences: [{ id: 'pv-cross-security-01-ref' }],
      expectedClaims: [
        { text: '高敏感数据导出前必须完成数据脱敏和安全审批', supportKeywords: ['数据脱敏', '安全审批'] },
        { text: '安全团队负责安全审批', supportKeywords: ['安全团队', '安全审批'] },
      ],
      expectedKeywords: ['数据脱敏', '安全审批', '安全团队', '高敏感数据'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      crossDepartment: true,
      sourceDocument: {
        id: 'pv-doc-security-cross',
        title: '数据导出跨部门审批',
        content: '身份证号、手机号、银行卡号属于高敏感数据。导出前必须完成数据脱敏和安全审批。安全团队负责安全审批。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
    {
      id: 'pv-cross-onboard-01',
      category: 'cross-department',
      department: 'it',
      documentType: 'permission-policy',
      query: '按制度回答：新员工入职后，权限申请需要经过哪些流程？',
      referenceAnswer: '新员工入职后由直属主管在 IT 系统中提交权限申请。默认生产系统权限有效期为 90 天。岗位变动后 48 小时内更新权限。[片段1]',
      referenceReferences: [{ id: 'pv-cross-onboard-01-ref' }],
      expectedClaims: [
        { text: '直属主管在 IT 系统提交权限申请', supportKeywords: ['直属主管', '权限申请'] },
        { text: '生产系统权限默认有效期为 90 天', supportKeywords: ['90 天', '生产系统权限'] },
      ],
      expectedKeywords: ['直属主管', '权限申请', '90 天'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      sourceDocument: {
        id: 'pv-doc-it-onboard',
        title: '员工入转调离权限流程',
        content: '新员工入职后由直属主管在 IT 系统中提交权限申请。默认生产系统权限有效期为 90 天。岗位变动后 48 小时内更新权限。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
  ];
  items.push(...crossDept);

  // ── Multi-hop reasoning scenarios ──────────────────────────────
  const multiHop = [
    {
      id: 'pv-multihop-travel-01',
      category: 'multi-hop',
      department: 'hr',
      documentType: 'policy',
      query: '按制度回答：我要去上海出差 3 天，住宿和伙食补贴一共能报销多少？',
      referenceAnswer: '一线城市（上海）住宿上限为 650 元/晚，3 晚住宿报销上限 1,950 元。国内出差伙食补贴每日 150 元，3 天共 450 元。合计可报销/补贴上限 2,400 元。[片段1][片段2]',
      referenceReferences: [{ id: 'pv-multihop-travel-01-ref' }],
      expectedClaims: [
        { text: '一线城市住宿报销上限为 650 元/晚', supportKeywords: ['650 元', '一线城市'] },
        { text: '国内出差伙食补贴每日 150 元', supportKeywords: ['150 元', '伙食补贴'] },
      ],
      expectedKeywords: ['650 元', '150 元', '住宿', '伙食补贴'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      sourceDocument: {
        id: 'pv-doc-hr-multihop',
        title: '出差综合费用标准',
        content: '一线城市住宿报销上限为 650 元/晚，国内出差伙食补贴每日 150 元。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
    {
      id: 'pv-multihop-permission-01',
      category: 'multi-hop',
      department: 'it',
      documentType: 'permission-policy',
      query: '按制度回答：我入职 6 个月，权限马上到期了，接下来要做什么？',
      referenceAnswer: '生产系统权限默认有效期为 90 天。入职 6 个月权限应该已经到期或即将到期。到期后需要重新提交权限申请并经过直属主管审批。[片段1]',
      referenceReferences: [{ id: 'pv-multihop-permission-01-ref' }],
      expectedClaims: [
        { text: '生产系统权限默认有效期为 90 天', supportKeywords: ['90 天', '有效期'] },
        { text: '重新提交权限申请并经过直属主管审批', supportKeywords: ['权限申请', '直属主管'] },
      ],
      expectedKeywords: ['90 天', '权限申请', '直属主管', '到期'],
      minKeywordCoverage: 0.5,
      requireCitation: true,
      sourceDocument: {
        id: 'pv-doc-it-multihop',
        title: '权限有效期操作指引',
        content: '生产系统权限默认有效期为 90 天，到期后需要重新提交权限申请并经过直属主管审批。',
        referenceIndex: 1,
      },
      ordinal: ++ordinal,
    },
  ];
  items.push(...multiHop);

  return {
    version: 'private-sanitized-2026-06-30',
    description:
      '脱敏私有企业模拟数据集（增强版）：包含标准 QA、版本冲突检测、拒答场景、跨部门协作、多步推理等测试用例。' +
      '所有数据均为通用行业模拟，不包含任何真实公司私密信息。' +
      '替换为真实私密样本时保持同一 schema。',
    total: items.length,
    items,
  };
}

/* ================================================================
 *  Domain definitions
 * ================================================================ */

function buildDomains() {
  return [
    {
      department: 'hr',
      documentType: 'policy',
      docTitle: '差旅制度',
      ask: '一线城市住宿报销上限是多少，发票多久内提交？',
      answer: '一线城市住宿报销上限为 650 元，费用必须在发票开具后 30 天内提交。[片段1]',
      cleanAnswer: '一线城市住宿报销上限为 650 元，费用必须在发票开具后 30 天内提交。',
      fact: '差旅制度：一线城市住宿报销上限为 650 元，二线城市为 480 元，费用必须在发票开具后 30 天内提交。',
      keywords: ['650 元', '30 天', '发票'],
    },
    {
      key: 'finance-sop',
      department: 'finance',
      documentType: 'sop',
      docTitle: '费用报销',
      ask: '发票开具后多久内要提交费用报销？超过时限怎么办？',
      answer: '费用报销需要在发票开具后 30 天内提交；超过 30 天需要部门负责人补充审批说明，超过 60 天不予报销。[片段1]',
      cleanAnswer: '费用报销需要在发票开具后 30 天内提交；超过 30 天需要部门负责人补充审批说明，超过 60 天不予报销。',
      fact: '费用报销：需要在发票开具后 30 天内提交，超过 30 天需要部门负责人补充审批说明，超过 60 天不予报销。',
      keywords: ['30 天', '60 天', '部门负责人', '审批说明'],
    },
    {
      department: 'legal',
      documentType: 'contract-guideline',
      docTitle: '合同审批',
      ask: '超过 50 万元的采购合同需要哪些复核？',
      answer: '金额超过 50 万元的采购合同必须经过法务复核和财务复核，缺一不可。[片段1]',
      cleanAnswer: '金额超过 50 万元的采购合同必须经过法务复核和财务复核，缺一不可。',
      fact: '合同审批：金额超过 50 万元的采购合同必须经过法务复核和财务复核，缺一不可。涉及关联交易的还需合规委员会审批。',
      keywords: ['50 万元', '法务复核', '财务复核'],
    },
    {
      department: 'it',
      documentType: 'permission-policy',
      docTitle: '权限管理',
      ask: '生产系统权限默认有效期多久？到期了怎么办？',
      answer: '生产系统权限默认有效期为 90 天，到期后需要重新提交权限申请并经过直属主管审批。[片段1]',
      cleanAnswer: '生产系统权限默认有效期为 90 天，到期后需要重新提交权限申请并经过直属主管审批。',
      fact: '权限管理：生产系统权限默认有效期为 90 天，到期后需要重新提交权限申请并经过直属主管审批。离职权限在离职当日 18:00 统一回收。',
      keywords: ['90 天', '权限申请', '直属主管'],
    },
    {
      department: 'sales',
      documentType: 'deal-desk',
      docTitle: '折扣审批',
      ask: '低于 8 折的客户折扣怎么审批？8 折以内谁审批？',
      answer: '低于 8 折的客户折扣必须提交 Deal Desk 评审，8 折以内由销售总监审批。[片段1]',
      cleanAnswer: '低于 8 折的客户折扣必须提交 Deal Desk 评审，8 折以内由销售总监审批。',
      fact: '折扣审批：低于 8 折的客户折扣必须提交 Deal Desk 评审，8 折以内由销售总监审批。Deal Desk 评审需要法务和财务确认。',
      keywords: ['8 折', 'Deal Desk', '销售总监'],
    },
    {
      department: 'customer-success',
      documentType: 'sla',
      docTitle: '客户 SLA',
      ask: '企业版客户一级工单多久内首次响应？普通版客户呢？',
      answer: '企业版客户的一级工单需要 1 小时内首次响应，普通版客户为 4 小时内首次响应。[片段1]',
      cleanAnswer: '企业版客户的一级工单需要 1 小时内首次响应，普通版客户为 4 小时内首次响应。',
      fact: '客户 SLA：企业版客户的一级工单需要 1 小时内首次响应，普通版客户为 4 小时内首次响应。P1 工单 1 小时未解决由值班经理介入。',
      keywords: ['企业版', '一级工单', '1 小时'],
    },
    {
      department: 'security',
      documentType: 'data-policy',
      docTitle: '数据分级',
      ask: '哪些字段属于高敏感数据？导出前要做什么？',
      answer: '身份证号、手机号、银行卡号属于高敏感数据，导出前必须完成数据脱敏和安全审批。[片段1]',
      cleanAnswer: '身份证号、手机号、银行卡号属于高敏感数据，导出前必须完成数据脱敏和安全审批。',
      fact: '数据分级：身份证号、手机号、银行卡号属于高敏感数据，导出前必须完成数据脱敏和安全审批。个人数据存储期限不超过业务必要期限 + 180 天。',
      keywords: ['身份证号', '手机号', '数据脱敏', '安全审批'],
    },
    {
      department: 'ops',
      documentType: 'incident-sop',
      docTitle: '故障响应',
      ask: 'P1 故障多久内要响应和复盘？',
      answer: 'P1 故障必须在 15 分钟内响应，2 小时内提交初步复盘，3 个工作日内提交正式复盘。[片段1]',
      cleanAnswer: 'P1 故障必须在 15 分钟内响应，2 小时内提交初步复盘，3 个工作日内提交正式复盘。',
      fact: '故障响应：P1 故障必须在 15 分钟内响应，2 小时内提交初步复盘，3 个工作日内提交正式复盘。P1 事件自动通知安全负责人和值班经理。',
      keywords: ['15 分钟', '2 小时', '3 个工作日'],
    },
    {
      department: 'product',
      documentType: 'release-policy',
      docTitle: '灰度发布',
      ask: '新功能灰度发布的流量顺序是什么？',
      answer: '新功能灰度发布必须先覆盖内部员工，再覆盖 5% 外部用户，核心指标稳定 24 小时后才能扩大流量。[片段1]',
      cleanAnswer: '新功能灰度发布必须先覆盖内部员工，再覆盖 5% 外部用户，核心指标稳定 24 小时后才能扩大流量。',
      fact: '灰度发布：新功能灰度发布必须先覆盖内部员工，再覆盖 5% 外部用户，核心指标稳定 24 小时后才能扩大流量。任一阶段指标异常立即回滚。',
      keywords: ['内部员工', '5%', '24 小时'],
    },
    {
      department: 'procurement',
      documentType: 'procurement-policy',
      docTitle: '供应商准入',
      ask: '新供应商准入需要哪些材料？',
      answer: '新供应商准入必须提供营业执照、对公账户证明和近一年合规承诺书，缺一不可。[片段1]',
      cleanAnswer: '新供应商准入必须提供营业执照、对公账户证明和近一年合规承诺书，缺一不可。',
      fact: '供应商准入：新供应商准入必须提供营业执照、对公账户证明和近一年合规承诺书，缺少任一材料不得建档。',
      keywords: ['营业执照', '对公账户证明', '合规承诺书'],
    },
    {
      department: 'data',
      documentType: 'data-governance',
      docTitle: '指标口径',
      ask: 'MAU 的统计口径是什么？哪些账号不纳入？',
      answer: 'MAU 统计自然月内至少登录一次的去重用户，不包含测试账号和内部压测账号。[片段1]',
      cleanAnswer: 'MAU 统计自然月内至少登录一次的去重用户，不包含测试账号和内部压测账号。',
      fact: '指标口径：MAU 统计自然月内至少登录一次的去重用户，不包含测试账号和内部压测账号。',
      keywords: ['自然月', '去重用户', '测试账号'],
    },
    {
      department: 'hr',
      documentType: 'leave-policy',
      docTitle: '年假制度',
      ask: '工龄 5 年能休几天年假？当年没休完怎么办？',
      answer: '工龄 4-7 年可休 10 天年假。当年未休完可结转最多 5 天至次年，离职时未休年假按日工资 300% 折算补偿。[片段1]',
      cleanAnswer: '工龄 4-7 年可休 10 天年假。当年未休完可结转最多 5 天至次年，离职时未休年假按日工资 300% 折算补偿。',
      fact: '年假制度：工龄 4-7 年可休 10 天年假，当年未休完可结转最多 5 天至次年。离职时未休年假按日工资 300% 折算补偿。',
      keywords: ['10 天', '5 天', '结转', '300%'],
    },
    {
      department: 'finance',
      documentType: 'budget-policy',
      docTitle: '预算管理',
      ask: '部门预算审批权限怎么划分？200 万的预算谁审批？',
      answer: '预算审批按金额划分：50 万以下部门负责人审批，50-200 万财务负责人 + 部门负责人，200 万以上需要 VP 审批。[片段1]',
      cleanAnswer: '预算审批按金额划分：50 万以下部门负责人审批，50-200 万财务负责人 + 部门负责人，200 万以上需要 VP 审批。',
      fact: '预算管理：预算审批按金额划分：50 万以下部门负责人审批，50-200 万财务负责人 + 部门负责人，200-500 万 VP + 财务负责人，500 万以上 CEO。',
      keywords: ['50 万', '200 万', '财务负责人', 'VP'],
    },
    {
      department: 'marketing',
      documentType: 'brand-guideline',
      docTitle: '品牌规范',
      ask: '对外宣传材料需要哪些审核？品牌色调的标准是什么？',
      answer: '对外宣传材料必须经过市场部审核，品牌主色调为蓝色（#0052CC），所有对外材料需法务合规审核。[片段1]',
      cleanAnswer: '对外宣传材料必须经过市场部审核，品牌主色调为蓝色（#0052CC），所有对外材料需法务合规审核。',
      fact: '品牌规范：对外宣传材料必须经过市场部审核，品牌主色调为蓝色（#0052CC），所有对外材料需法务合规审核。',
      keywords: ['市场部', '#0052CC', '法务', '合规'],
    },
    {
      department: 'engineering',
      documentType: 'coding-standards',
      docTitle: '编码规范',
      ask: '代码审查必须多少人通过？生产环境部署有什么要求？',
      answer: '代码审查至少需要 1 名 Senior 工程师通过。生产环境部署必须在工作日 10:00-16:00 进行，且必须经过测试环境验证。[片段1]',
      cleanAnswer: '代码审查至少需要 1 名 Senior 工程师通过。生产环境部署必须在工作日 10:00-16:00 进行，且必须经过测试环境验证。',
      fact: '编码规范：代码审查至少需要 1 名 Senior 工程师通过。生产环境部署必须在工作日 10:00-16:00 进行，且必须经过测试环境验证。',
      keywords: ['Senior', '代码审查', '10:00', '16:00', '测试环境'],
    },
  ];
}

/* ================================================================
 *  Multimodal dataset
 * ================================================================ */

function makeMultimodalDataset() {
  return {
    version: 'private-sanitized-2026-06-30',
    description:
      '脱敏多模态样本包（增强版）。包含真实存在的本地文件路径，覆盖文本/表格/结构体/HTML/音频/图片/视频模态。',
    documents: [
      {
        id: 'private-hr-travel-policy',
        type: 'markdown',
        filename: 'hr-travel-policy-2026.md',
        path: 'eval/private-fixtures/documents/hr-travel-policy-2026.md',
        status: 'ready',
        expectedModalities: ['text', 'table'],
      },
      {
        id: 'private-hr-annual-leave',
        type: 'markdown',
        filename: 'hr-annual-leave.md',
        path: 'eval/private-fixtures/documents/hr-annual-leave.md',
        status: 'ready',
        expectedModalities: ['text', 'table'],
      },
      {
        id: 'private-finance-sop',
        type: 'markdown',
        filename: 'finance-expense-sop.md',
        path: 'eval/private-fixtures/documents/finance-expense-sop.md',
        status: 'ready',
        expectedModalities: ['text', 'table', 'structured'],
      },
      {
        id: 'private-legal-contract',
        type: 'markdown',
        filename: 'legal-contract-workflow.md',
        path: 'eval/private-fixtures/documents/legal-contract-workflow.md',
        status: 'ready',
        expectedModalities: ['text', 'table'],
      },
      {
        id: 'private-sales-deal',
        type: 'markdown',
        filename: 'sales-deal-desk-playbook.md',
        path: 'eval/private-fixtures/documents/sales-deal-desk-playbook.md',
        status: 'ready',
        expectedModalities: ['text', 'table'],
      },
      {
        id: 'private-ops-incident',
        type: 'markdown',
        filename: 'ops-incident-runbook.md',
        path: 'eval/private-fixtures/documents/ops-incident-runbook.md',
        status: 'ready',
        expectedModalities: ['text', 'table'],
      },
      {
        id: 'private-product-release',
        type: 'markdown',
        filename: 'product-release-process.md',
        path: 'eval/private-fixtures/documents/product-release-process.md',
        status: 'ready',
        expectedModalities: ['text', 'table', 'checklist'],
      },
      {
        id: 'private-security-incident',
        type: 'markdown',
        filename: 'security-incident-response.md',
        path: 'eval/private-fixtures/documents/security-incident-response.md',
        status: 'ready',
        expectedModalities: ['text', 'table'],
      },
      {
        id: 'private-cs-sla-v2',
        type: 'markdown',
        filename: 'customer-success-sla-v2.md',
        path: 'eval/private-fixtures/documents/customer-success-sla-v2.md',
        status: 'ready',
        expectedModalities: ['text', 'table'],
      },
      {
        id: 'private-data-governance',
        type: 'markdown',
        filename: 'data-governance-metrics.md',
        path: 'eval/private-fixtures/documents/data-governance-metrics.md',
        status: 'ready',
        expectedModalities: ['text', 'structured'],
      },
      {
        id: 'private-meeting-audio',
        type: 'audio',
        filename: 'meeting-action-items.wav',
        path: 'eval/private-fixtures/media/meeting-action-items.wav',
        status: 'ready',
        expectedModalities: ['speech', 'text'],
        transcriptPath: 'eval/private-fixtures/documents/meeting-action-items.txt',
      },
      {
        id: 'private-dashboard-image',
        type: 'image',
        filename: 'dashboard-screenshot.png',
        path: 'eval/private-fixtures/media/dashboard-screenshot.png',
        status: 'ready',
        expectedModalities: ['image', 'ocr'],
      },
      {
        id: 'private-approval-video',
        type: 'video',
        filename: 'approval-training.mp4',
        path: 'eval/private-fixtures/media/approval-training.mp4',
        status: 'ready',
        expectedModalities: ['video', 'speech', 'text'],
        transcriptPath: 'eval/private-fixtures/documents/training-approval-transcript.md',
      },
    ],
    queries: [
      // ── Text queries ──
      {
        id: 'private-table-limit',
        query: '一线城市住宿报销上限是多少？三线城市呢？',
        expectedKeywords: ['650 元', '320 元'],
        requireCitation: true,
        sourceDocumentIds: ['private-hr-travel-policy'],
      },
      {
        id: 'private-contract-class',
        query: '采购合同超过 50 万元属于哪类合同？需要什么审批？',
        expectedKeywords: ['重大合同', 'C 类', '法务复核', '财务复核'],
        requireCitation: true,
        sourceDocumentIds: ['private-legal-contract'],
      },
      {
        id: 'private-release-grayscale',
        query: '灰度发布的阶段和观察时间分别是什么？',
        expectedKeywords: ['内部员工', '5%', '24 小时', '全量发布'],
        requireCitation: true,
        sourceDocumentIds: ['private-product-release'],
      },
      {
        id: 'private-sla-v2-change',
        query: '企业版客户 P1 工单的 SLA 在 v2 中有什么变化？',
        expectedKeywords: ['1 小时', 'v2.0', '首次响应'],
        requireCitation: true,
        sourceDocumentIds: ['private-cs-sla-v2'],
      },
      // ── Audio-related ──
      {
        id: 'private-audio-actions',
        query: '会议行动项里数据导出前要完成什么？',
        expectedKeywords: ['数据脱敏', '安全审批'],
        requireCitation: true,
        sourceDocumentIds: ['private-meeting-audio'],
      },
      // ── Image-related ──
      {
        id: 'private-image-ocr',
        query: '截图中应能识别出哪个模块？',
        expectedKeywords: ['SLA'],
        requireCitation: false,
        sourceDocumentIds: ['private-dashboard-image'],
      },
      // ── Video-related ──
      {
        id: 'private-video-approval',
        query: '培训视频转写里采购合同超过 50 万元需要什么？',
        expectedKeywords: ['法务复核', '财务复核'],
        requireCitation: true,
        sourceDocumentIds: ['private-approval-video'],
      },
    ],
  };
}

/* ================================================================
 *  GraphRAG seed (5 → 10 documents with richer entities)
 * ================================================================ */

function makeGraphSeed() {
  return {
    version: 'private-sanitized-2026-06-30',
    description:
      '脱敏 GraphRAG 业务图谱种子（增强版），包含跨部门实体关系、别名和职责链。可 dry-run 校验或导入本地 Neo4j。',
    documents: [
      {
        sourceId: 'private-graph-customer-sla',
        title: '客户 SLA 团队与职责关系',
        text: '客户成功团队负责企业版客户 SLA。企业版客户的一级工单需要 1 小时内首次响应。一级工单升级后由值班经理协调研发团队处理。值班经理是客户成功团队的岗位，研发团队由研发负责人管理。',
        query: '企业版客户一级工单涉及哪些团队和角色？',
      },
      {
        sourceId: 'private-graph-contract-approval',
        title: '合同审批跨部门流程',
        text: '采购合同超过 50 万元时，需要法务复核和财务复核。采购负责人提交合同后，法务负责人确认条款风险，财务负责人确认预算。法务部有法务负责人岗位，财务部有财务负责人岗位。',
        query: '超过 50 万元的采购合同需要哪些角色复核？',
      },
      {
        sourceId: 'private-graph-security-export',
        title: '数据导出审批链路',
        text: '身份证号、手机号、银行卡号属于高敏感数据。高敏感数据导出前必须完成数据脱敏和安全审批。安全团队负责安全审批，安全部门下设安全审批人岗位。数据所属部门负责人需确认导出必要性。',
        query: '高敏感数据导出涉及哪些角色和审批？',
      },
      {
        sourceId: 'private-graph-it-permission',
        title: '生产权限生命周期',
        text: '生产系统权限默认有效期为 90 天。权限到期后，申请人需要重新提交权限申请，直属主管负责审批。IT 部门管理权限系统。离职员工权限在离职当日 18:00 统一回收。',
        query: '生产权限从申请到回收涉及哪些角色？',
      },
      {
        sourceId: 'private-graph-deal-desk',
        title: '折扣审批协作网络',
        text: '低于 8 折的客户折扣必须提交 Deal Desk 评审。8 折以内由销售总监审批。Deal Desk 评审会同步法务确认风险，并同步财务确认利润模型。毛利率不低于 20%。战略客户年合同额超过 500 万可申请额外 5% 折扣。',
        query: '折扣审批流程中法务和财务的职责是什么？',
      },
      {
        sourceId: 'private-graph-incident-escalation',
        title: '故障升级通知链',
        text: 'P1 事件自动通知安全负责人和值班经理。事件处置超过 1 小时未解决升级至安全部门负责人。超过 4 小时未解决升级至 CISO。值班经理属于客户成功部，安全负责人和安全部门负责人属于安全部。',
        query: 'P1 安全事件升级通知涉及哪些角色？',
      },
      {
        sourceId: 'private-graph-budget-approval',
        title: '预算审批权限链',
        text: '预算审批按金额划分部门负责人审批 50 万以下，财务负责人 + 部门负责人审批 50-200 万。VP 审批 200-500 万。CEO 审批 500 万以上。各岗位按部门树归属。',
        query: '不同金额区间的预算分别由谁审批？',
      },
      {
        sourceId: 'private-graph-supplier-lifecycle',
        title: '供应商准入与合同流程',
        text: '新供应商准入由采购部负责，需要营业执照、对公账户证明和近一年合规承诺书。B 级供应商采购金额 10-100 万元。C 级供应商采购金额低于 10 万元。采购合同超 50 万元需法务和财务复核。',
        query: '供应商从准入到合同签署涉及哪些部门和角色？',
      },
      {
        sourceId: 'private-graph-leave-approval',
        title: '年假审批关系',
        text: '年假连续休假超过 5 天需部门负责人审批。事假超过 3 天需 VP 审批。HR 部门管理年假制度。年假离职补偿按日工资 300% 计算，由财务部执行。',
        query: '年假和事假的审批分别由谁负责？',
      },
      {
        sourceId: 'private-graph-data-privacy',
        title: '数据主体权利响应流程',
        text: '数据查阅请求 15 个工作日内响应，由法务部处理。数据删除请求 30 个工作日内完成。拒绝处理需法务部书面意见。个人数据存储期限不超过业务必要期限加 180 天。员工离职后 30 天内删除或匿名化所有个人数据。',
        query: '数据主体权利请求的响应时间由哪些部门负责？',
      },
    ],
  };
}

/* ================================================================
 *  Organization fixture (expanded tree)
 * ================================================================ */

function makeOrganizationFixture() {
  return {
    version: 'private-sanitized-2026-06-30',
    departments: [
      // Top level
      { id: 'dept-exec', name: '高管团队', parentId: null },
      // Business
      { id: 'dept-sales', name: '销售部', parentId: null },
      { id: 'dept-cs', name: '客户成功部', parentId: null },
      { id: 'dept-product', name: '产品部', parentId: null },
      // Enablement
      { id: 'dept-hr', name: '人力资源部', parentId: null },
      { id: 'dept-finance', name: '财务部', parentId: null },
      { id: 'dept-legal', name: '法务部', parentId: null },
      { id: 'dept-security', name: '安全部', parentId: null },
      { id: 'dept-it', name: '信息技术部', parentId: null },
      { id: 'dept-ops', name: '运维部', parentId: null },
      { id: 'dept-admin', name: '行政部', parentId: null },
      // Sub-departments
      { id: 'dept-sales-east', name: '华东销售团队', parentId: 'dept-sales' },
      { id: 'dept-sales-west', name: '西部销售团队', parentId: 'dept-sales' },
      { id: 'dept-ops-sre', name: 'SRE 组', parentId: 'dept-ops' },
      { id: 'dept-ops-noc', name: 'NOC 值班组', parentId: 'dept-ops' },
    ],
    positions: [
      { id: 'pos-ceo', name: 'CEO', departmentId: 'dept-exec' },
      { id: 'pos-vp-sales', name: '销售 VP', departmentId: 'dept-sales' },
      { id: 'pos-sales-dir', name: '销售总监', departmentId: 'dept-sales' },
      { id: 'pos-vp-product', name: '产品 VP', departmentId: 'dept-product' },
      { id: 'pos-pm-lead', name: 'PM 负责人', departmentId: 'dept-product' },
      { id: 'pos-hr-owner', name: 'HR 负责人', departmentId: 'dept-hr' },
      { id: 'pos-finance-owner', name: '财务负责人', departmentId: 'dept-finance' },
      { id: 'pos-legal-owner', name: '法务负责人', departmentId: 'dept-legal' },
      { id: 'pos-security-owner', name: '安全负责人', departmentId: 'dept-security' },
      { id: 'pos-security-reviewer', name: '安全审批人', departmentId: 'dept-security' },
      { id: 'pos-ciso', name: 'CISO', departmentId: 'dept-security' },
      { id: 'pos-it-owner', name: 'IT 负责人', departmentId: 'dept-it' },
      { id: 'pos-ops-owner', name: '运维负责人', departmentId: 'dept-ops' },
      { id: 'pos-duty-manager', name: '值班经理', departmentId: 'dept-cs' },
      { id: 'pos-cs-owner', name: '客户成功负责人', departmentId: 'dept-cs' },
      { id: 'pos-procurement', name: '采购负责人', departmentId: 'dept-finance' },
      { id: 'pos-admin-owner', name: '行政负责人', departmentId: 'dept-admin' },
    ],
    users: [
      { id: '1', username: 'admin', departmentId: 'dept-finance', positionId: 'pos-finance-owner', roles: ['admin'] },
      { id: '2', username: 'user', departmentId: 'dept-cs', positionId: 'pos-duty-manager', roles: ['user'] },
      { id: '3', username: 'zhangsan', departmentId: 'dept-sales', positionId: 'pos-sales-dir', roles: ['user'] },
      { id: '4', username: 'lisi', departmentId: 'dept-legal', positionId: 'pos-legal-owner', roles: ['knowledge-manager'] },
      { id: '5', username: 'wangwu', departmentId: 'dept-it', positionId: 'pos-it-owner', roles: ['user'] },
    ],
    roles: [
      { id: 'admin', name: '管理员', inherits: ['knowledge-manager', 'security-auditor'] },
      { id: 'knowledge-manager', name: '知识库管理员', inherits: ['user'] },
      { id: 'security-auditor', name: '安全审计员', inherits: ['user'] },
      { id: 'user', name: '普通用户', inherits: [] },
    ],
    permissionExpectations: [
      {
        docId: 'private-hr-travel-policy',
        readableBy: [
          { subjectType: 'role', subjectId: 'knowledge-manager' },
          { subjectType: 'department', subjectId: 'dept-finance' },
          { subjectType: 'department', subjectId: 'dept-hr' },
        ],
      },
      {
        docId: 'private-cs-sla-v2',
        readableBy: [
          { subjectType: 'role', subjectId: 'user' },
          { subjectType: 'department', subjectId: 'dept-cs' },
          { subjectType: 'department', subjectId: 'dept-sales' },
        ],
      },
      {
        docId: 'private-legal-contract',
        readableBy: [
          { subjectType: 'role', subjectId: 'knowledge-manager' },
          { subjectType: 'department', subjectId: 'dept-legal' },
          { subjectType: 'department', subjectId: 'dept-finance' },
        ],
      },
      {
        docId: 'private-security-incident',
        readableBy: [
          { subjectType: 'role', subjectId: 'security-auditor' },
          { subjectType: 'department', subjectId: 'dept-security' },
          { subjectType: 'department', subjectId: 'dept-ops' },
        ],
      },
      {
        docId: 'private-sales-deal',
        readableBy: [
          { subjectType: 'role', subjectId: 'user' },
          { subjectType: 'department', subjectId: 'dept-sales' },
        ],
      },
    ],
  };
}

/* ================================================================
 *  Validation
 * ================================================================ */

async function checkFixtures() {
  const docFiles = Object.keys(buildDocumentFiles());
  const required = [
    files.businessDataset,
    files.multimodalDataset,
    files.graphSeed,
    files.organization,
    ...docFiles.map((name) => resolve(docsDir, name)),
    resolve(mediaDir, 'meeting-action-items.wav'),
    resolve(mediaDir, 'dashboard-screenshot.png'),
    resolve(mediaDir, 'approval-training.mp4'),
  ];

  const missing = [];
  for (const file of required) {
    try {
      await readFile(file);
    } catch {
      missing.push(file);
    }
  }

  const business = JSON.parse(await readFile(files.businessDataset, 'utf8'));
  const multimodal = JSON.parse(await readFile(files.multimodalDataset, 'utf8'));
  const graph = JSON.parse(await readFile(files.graphSeed, 'utf8'));
  const organization = JSON.parse(await readFile(files.organization, 'utf8'));

  const businessItems = business.items ?? [];
  const multimodalDocs = multimodal.documents ?? [];
  const graphDocs = graph.documents ?? [];
  const departments = organization.departments ?? [];

  // Validate enhanced dataset expectations
  const hasConflict = businessItems.some((i) => i.expectConflictHandling);
  const hasRefusal = businessItems.some((i) => i.expectRefusal);
  const hasCrossDept = businessItems.some((i) => i.crossDepartment);

  const report = {
    ok:
      missing.length === 0 &&
      businessItems.length >= 85 &&
      multimodalDocs.length >= 10 &&
      graphDocs.length >= 8 &&
      departments.length >= 10 &&
      hasConflict &&
      hasRefusal &&
      hasCrossDept,
    mode: checkOnly ? 'check' : 'prepare',
    fixturesDir,
    businessCases: businessItems.length,
    multimodalDocuments: multimodalDocs.length,
    graphDocuments: graphDocs.length,
    departments: departments.length,
    hasConflictScenarios: hasConflict,
    hasRefusalScenarios: hasRefusal,
    hasCrossDepartmentScenarios: hasCrossDept,
    missing,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

/* ================================================================
 *  Minimal media file generators (same as before)
 * ================================================================ */

function makeSilentWav(seconds) {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function makeMinimalPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJqY2QAAAABJRU5ErkJggg==',
    'base64',
  );
}

function makeMinimalMp4() {
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);
  const free = Buffer.from([
    0x00, 0x00, 0x00, 0x10, 0x66, 0x72, 0x65, 0x65,
    0x52, 0x41, 0x47, 0x20, 0x66, 0x69, 0x78, 0x74,
  ]);
  return Buffer.concat([ftyp, free]);
}
