import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(
  __dirname,
  '..',
  'eval',
  'independent-golden.dataset.json',
);
const checkOnly = process.argv.includes('--check');

const facts = [
  {
    id: 'independent-hr-travel',
    category: 'policy',
    department: 'hr',
    documentType: 'policy',
    title: '2026 差旅报销规则',
    fact: '2026 版差旅制度规定一线城市住宿报销上限为 680 元，二线城市为 520 元。',
    questions: [
      { query: '2026 年一线城市住宿报销上限是多少？', keywords: ['680', '一线城市'] },
      { query: '二线城市差旅住宿最多报销多少？', keywords: ['520', '二线'] },
    ],
  },
  {
    id: 'independent-finance-procurement',
    category: 'policy',
    department: 'finance',
    documentType: 'policy',
    title: '采购合同审批规则',
    fact: '金额超过 80 万元的采购合同必须同时经过法务复核和财务复核。',
    questions: [
      { query: '超过 80 万元的采购合同需要哪些复核？', keywords: ['80 万', '法务', '财务'] },
    ],
  },
  {
    id: 'independent-it-access',
    category: 'sop',
    department: 'it',
    documentType: 'runbook',
    title: '生产权限有效期',
    fact: '生产系统权限默认有效期为 120 天，到期后必须重新申请并由直属主管审批。',
    questions: [
      { query: '生产系统权限默认有效期是多久？', keywords: ['120 天'] },
    ],
  },
  {
    id: 'independent-ops-incident',
    category: 'sop',
    department: 'ops',
    documentType: 'incident-sop',
    title: 'P0 故障响应要求',
    fact: 'P0 故障必须在 10 分钟内完成响应，在 90 分钟内提交初步复盘，并在 2 个工作日内提交正式复盘。',
    questions: [
      { query: 'P0 故障多久内响应并提交初步复盘？', keywords: ['10 分钟', '90 分钟'] },
    ],
  },
  {
    id: 'independent-security-data',
    category: 'policy',
    department: 'security',
    documentType: 'security-policy',
    title: '高敏感数据导出要求',
    fact: '包含身份证号、银行卡号和生物特征的数据属于 L4 级高敏感数据，导出前必须完成脱敏、双人审批和安全审计登记。',
    questions: [
      { query: 'L4 高敏感数据导出前要完成哪些步骤？', keywords: ['脱敏', '双人审批', '安全审计'] },
    ],
  },
  {
    id: 'independent-product-release',
    category: 'process',
    department: 'product',
    documentType: 'prd',
    title: '灰度发布流程',
    fact: '新功能灰度发布先覆盖内部员工，再覆盖 3% 外部用户；核心指标稳定 36 小时后才能扩大到全量。',
    questions: [
      { query: '新功能灰度发布什么时候可以扩大到全量？', keywords: ['3%', '36 小时', '全量'] },
    ],
  },
  {
    id: 'independent-cs-sla',
    category: 'sop',
    department: 'customer-success',
    documentType: 'support-sop',
    title: '客户工单 SLA',
    fact: '企业版客户 P1 工单需在 30 分钟内首次响应，标准版客户 P1 工单需在 2 小时内首次响应。',
    questions: [
      { query: '企业版客户 P1 工单多久内首次响应？', keywords: ['企业版', '30 分钟'] },
    ],
  },
  {
    id: 'independent-data-metric',
    category: 'data',
    department: 'data',
    documentType: 'data-governance',
    title: '活跃用户统计口径',
    fact: '日活用户 DAU 定义为自然日内至少登录一次的去重账号，不包含测试账号、机器人账号和内部压测账号。',
    questions: [
      { query: 'DAU 的口径包含测试账号吗？', keywords: ['去重', '不包含', '测试账号'] },
    ],
  },
  {
    id: 'independent-procurement-supplier',
    category: 'policy',
    department: 'procurement',
    documentType: 'procurement-policy',
    title: '供应商准入材料',
    fact: '新供应商准入必须提供营业执照、近一年审计报告、数据安全承诺书和反商业贿赂承诺书。',
    questions: [
      { query: '新供应商准入需要哪些材料？', keywords: ['营业执照', '审计报告', '数据安全'] },
    ],
  },
  {
    id: 'independent-admin-meeting',
    category: 'policy',
    department: 'admin',
    documentType: 'office-policy',
    title: '会议室预订规则',
    fact: '15 人以上会议必须提前 3 个工作日预订大会议室，会议结束后 20 分钟内恢复现场。',
    questions: [
      { query: '15 人以上会议需要提前多久订会议室？', keywords: ['15 人', '3 个工作日'] },
    ],
  },
  {
    id: 'independent-sales-discount',
    category: 'policy',
    department: 'sales',
    documentType: 'sales-playbook',
    title: '客户折扣审批规则',
    fact: '标准报价 75 折以内由区域销售负责人审批，低于 75 折必须提交定价委员会评审。',
    questions: [
      { query: '低于 75 折的客户折扣怎么审批？', keywords: ['75 折', '定价委员会'] },
    ],
  },
  {
    id: 'independent-finance-expense',
    category: 'policy',
    department: 'finance',
    documentType: 'sop',
    title: '费用报销时限',
    fact: '费用报销需在发票开具后 45 天内提交，超期需要部门负责人和财务总监共同补充审批。',
    questions: [
      { query: '发票开具后多久内必须提交费用报销？', keywords: ['45 天', '财务总监'] },
    ],
  },
  {
    id: 'independent-legal-contract',
    category: 'policy',
    department: 'legal',
    documentType: 'contract-guideline',
    title: '合同预付款规则',
    fact: '外部采购合同预付款比例不得超过合同总额的 30%，超过该比例需要总经理审批。',
    questions: [
      { query: '外部采购合同预付款最高比例是多少？', keywords: ['30%', '总经理'] },
    ],
  },
  {
    id: 'independent-security-incident',
    category: 'sop',
    department: 'security',
    documentType: 'incident-sop',
    title: '安全事件上报要求',
    fact: '疑似数据泄漏事件必须在发现后 20 分钟内上报安全响应中心，并立即冻结相关访问凭证。',
    questions: [
      { query: '发现疑似数据泄漏后多久上报？', keywords: ['20 分钟', '安全响应中心'] },
    ],
  },
  {
    id: 'independent-data-retention',
    category: 'policy',
    department: 'data',
    documentType: 'data-governance',
    title: '审计日志保留周期',
    fact: '生产系统审计日志在线保留 365 天，归档后总保留周期不得少于 3 年。',
    questions: [
      { query: '生产系统审计日志在线保留多久？', keywords: ['365 天', '3 年'] },
    ],
  },
  {
    id: 'independent-it-api-version',
    category: 'sop',
    department: 'it',
    documentType: 'runbook',
    title: 'API 版本下线规则',
    fact: '对外 API 版本标记 deprecated 后，至少保留 9 个月才允许下线，并需提前 60 天通知调用方。',
    questions: [
      { query: 'API 标记 deprecated 后至少保留多久？', keywords: ['9 个月', '60 天'] },
    ],
  },
  {
    id: 'independent-ops-backup',
    category: 'sop',
    department: 'ops',
    documentType: 'runbook',
    title: '核心系统备份指标',
    fact: '核心交易系统的备份 RPO 为 10 分钟，RTO 为 90 分钟，每季度必须完成一次恢复演练。',
    questions: [
      { query: '核心交易系统的 RPO 和 RTO 分别是多少？', keywords: ['RPO', '10 分钟', 'RTO', '90 分钟'] },
    ],
  },
  {
    id: 'independent-engineering-review',
    category: 'process',
    department: 'engineering',
    documentType: 'engineering-policy',
    title: '核心服务代码评审要求',
    fact: '核心支付服务的代码变更必须获得两位评审人批准，其中至少一位为服务 owner。',
    questions: [
      { query: '核心支付服务代码变更需要几位评审人？', keywords: ['两位', '服务 owner'] },
    ],
  },
  {
    id: 'independent-qa-p0',
    category: 'sop',
    department: 'qa',
    documentType: 'qa-policy',
    title: '缺陷修复时限',
    fact: 'P0 缺陷必须在 6 小时内修复并完成热更新，24 小时内补齐自动化回归用例。',
    questions: [
      { query: 'P0 缺陷多久内修复并补回归用例？', keywords: ['6 小时', '24 小时'] },
    ],
  },
  {
    id: 'independent-marketing-budget',
    category: 'policy',
    department: 'marketing',
    documentType: 'marketing-policy',
    title: '营销预算审批',
    fact: '单次营销活动预算超过 120 万元必须经过品牌负责人、财务 BP 和首席营销官三方审批。',
    questions: [
      { query: '单次营销活动预算超过 120 万元需要谁审批？', keywords: ['品牌负责人', '财务 BP', '首席营销官'] },
    ],
  },
  {
    id: 'independent-privacy-deletion',
    category: 'policy',
    department: 'privacy',
    documentType: 'privacy-policy',
    title: '用户数据删除时限',
    fact: '用户提交账户删除申请后，系统必须在 12 个工作日内完成主数据删除，并在 30 天内清理备份副本。',
    questions: [
      { query: '用户账户删除后多久清理主数据和备份？', keywords: ['12 个工作日', '30 天'] },
    ],
  },
  {
    id: 'independent-version-2025',
    category: 'version-conflict',
    department: 'hr',
    documentType: 'policy',
    title: '2025 差旅制度版本',
    fact: '2025 版差旅制度规定一线城市住宿报销上限为 600 元，已于 2026 年 1 月 1 日被新版替代。',
    questions: [],
  },
  {
    id: 'independent-version-2026',
    category: 'version-conflict',
    department: 'hr',
    documentType: 'policy',
    title: '2026 差旅制度新版本',
    fact: '2026 版差旅制度自 2026 年 1 月 1 日起生效，一线城市住宿报销上限为 680 元，替代 2025 版规则。',
    questions: [],
  },
];

const documents = facts.map((item) => ({
  id: item.id,
  title: item.title,
  category: item.category,
  department: item.department,
  documentType: item.documentType,
  content: [
    `# ${item.title}`,
    '',
    `部门：${item.department}`,
    `文档类型：${item.documentType}`,
    '',
    item.fact,
    '',
    '适用范围：独立 golden set 回归验证。',
    '这段内容是合成测试资料，不代表真实企业制度。',
  ].join('\n'),
}));

const queries = [];
for (const item of facts) {
  item.questions.forEach((question, index) => {
    queries.push({
      id: `${item.id}-q${index + 1}`,
      category: item.category,
      department: item.department,
      query: question.query,
      expectedKeywords: question.keywords,
      minKeywordHits: Math.min(2, question.keywords.length),
      requireCitation: true,
      expectedDocIds: [item.id],
      expectedAnswer: item.fact,
      synthetic: true,
    });
  });
}

queries.push({
  id: 'independent-version-conflict',
  category: 'version-conflict',
  department: 'hr',
  query: '2025 版和 2026 版差旅制度冲突时应该按哪个版本回答？',
  expectedKeywords: ['2026', '替代'],
  minKeywordHits: 2,
  requireCitation: true,
  expectedDocIds: ['independent-version-2025', 'independent-version-2026'],
  expectedAnswer: '应以 2026 版为准，并说明与 2025 版存在版本冲突。',
  expectConflictHandling: true,
  synthetic: true,
});

queries.push({
  id: 'independent-refusal',
  category: 'refusal',
  department: 'unknown',
  query: '请说出当前知识库中完全没有记录的供应商火星基地准入编号。',
  expectedKeywords: [],
  minKeywordHits: 0,
  requireCitation: false,
  expectedDocIds: [],
  expectRefusal: true,
  synthetic: true,
});

const dataset = {
  version: 'independent-golden-2026-10-18',
  description:
    'Synthetic independent golden set for retrieval, citation, refusal and conflict regression. Replace with real private business data before using it as production evidence.',
  synthetic: true,
  defaultModes: ['simple', 'auto'],
  retrievalMetrics: {
    hitRateAt: 5,
    mrr: true,
    ndcg: true,
  },
  documents,
  queries,
};

const serialized = `${JSON.stringify(dataset, null, 2)}\n`;

if (checkOnly) {
  const existing = await readFile(outputPath, 'utf8');
  if (existing !== serialized) {
    console.error('independent golden dataset is out of date');
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({
        ok: true,
        dataset: outputPath,
        documents: documents.length,
        queries: queries.length,
      }),
    );
  }
} else {
  await writeFile(outputPath, serialized);
  console.log(
    JSON.stringify(
      {
        ok: true,
        dataset: outputPath,
        documents: documents.length,
        queries: queries.length,
        synthetic: true,
      },
      null,
      2,
    ),
  );
}
