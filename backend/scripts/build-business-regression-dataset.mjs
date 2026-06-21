import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(
  __dirname,
  '..',
  'eval',
  'business-regression.dataset.json',
);
const checkOnly = process.argv.includes('--check');

const departments = [
  {
    department: 'hr',
    documentType: 'policy',
    topic: '差旅制度',
    fact: '2026 版差旅制度规定一线城市住宿报销上限为 650 元，二线城市为 480 元，2026 版优先生效。',
    ask: '2026 年一线城市住宿报销上限是多少？',
    answer: '2026 年一线城市住宿报销上限为 650 元，且 2026 版优先生效。[片段1]',
    keywords: ['2026', '650 元', '优先生效'],
  },
  {
    department: 'finance',
    documentType: 'sop',
    topic: '费用报销',
    fact: '费用报销需要在发票开具后 30 天内提交，超过 30 天需要部门负责人补充审批说明。',
    ask: '发票开具后多久内要提交费用报销？',
    answer: '费用报销需要在发票开具后 30 天内提交；超过 30 天需要部门负责人补充审批说明。[片段1]',
    keywords: ['30 天', '部门负责人', '审批说明'],
  },
  {
    department: 'legal',
    documentType: 'contract-guideline',
    topic: '合同审批',
    fact: '金额超过 50 万元的采购合同必须经过法务复核和财务复核，缺一不可。',
    ask: '超过 50 万元的采购合同需要哪些复核？',
    answer: '金额超过 50 万元的采购合同必须经过法务复核和财务复核，缺一不可。[片段1]',
    keywords: ['50 万元', '法务复核', '财务复核'],
  },
  {
    department: 'it',
    documentType: 'runbook',
    topic: '账号权限',
    fact: '生产系统权限默认有效期为 90 天，到期后需要重新提交权限申请并经过直属主管审批。',
    ask: '生产系统权限默认有效期多久？',
    answer: '生产系统权限默认有效期为 90 天，到期后需要重新提交权限申请并经过直属主管审批。[片段1]',
    keywords: ['90 天', '权限申请', '直属主管'],
  },
  {
    department: 'sales',
    documentType: 'playbook',
    topic: '客户折扣',
    fact: '标准报价 8 折以内由销售总监审批，低于 8 折必须提交 Deal Desk 评审。',
    ask: '低于 8 折的客户折扣怎么审批？',
    answer: '低于 8 折的客户折扣必须提交 Deal Desk 评审；8 折以内由销售总监审批。[片段1]',
    keywords: ['8 折', 'Deal Desk', '销售总监'],
  },
  {
    department: 'ops',
    documentType: 'incident-sop',
    topic: '故障响应',
    fact: 'P1 故障必须在 15 分钟内完成响应，在 2 小时内提交初步复盘，并在 3 个工作日内提交正式复盘。',
    ask: 'P1 故障多久内要响应和复盘？',
    answer: 'P1 故障必须在 15 分钟内响应，2 小时内提交初步复盘，3 个工作日内提交正式复盘。[片段1]',
    keywords: ['15 分钟', '2 小时', '3 个工作日'],
  },
  {
    department: 'security',
    documentType: 'security-policy',
    topic: '数据分级',
    fact: '包含身份证号、手机号、银行卡号的数据属于高敏感数据，导出前必须完成数据脱敏和安全审批。',
    ask: '哪些数据属于高敏感数据，导出前要做什么？',
    answer: '身份证号、手机号、银行卡号属于高敏感数据，导出前必须完成数据脱敏和安全审批。[片段1]',
    keywords: ['身份证号', '手机号', '数据脱敏', '安全审批'],
  },
  {
    department: 'product',
    documentType: 'prd',
    topic: '灰度发布',
    fact: '新功能灰度发布必须先覆盖内部员工，再覆盖 5% 外部用户，核心指标稳定 24 小时后才能扩大流量。',
    ask: '新功能灰度发布的流量顺序是什么？',
    answer: '新功能灰度发布必须先覆盖内部员工，再覆盖 5% 外部用户；核心指标稳定 24 小时后才能扩大流量。[片段1]',
    keywords: ['内部员工', '5%', '24 小时'],
  },
  {
    department: 'customer-success',
    documentType: 'support-sop',
    topic: 'SLA',
    fact: '企业版客户的一级工单需要 1 小时内首次响应，普通版客户的一级工单需要 4 小时内首次响应。',
    ask: '企业版客户一级工单多久内首次响应？',
    answer: '企业版客户的一级工单需要 1 小时内首次响应；普通版客户为 4 小时内首次响应。[片段1]',
    keywords: ['企业版', '一级工单', '1 小时'],
  },
  {
    department: 'data',
    documentType: 'data-governance',
    topic: '指标口径',
    fact: '月活用户 MAU 统计自然月内至少登录一次的去重用户，不包含测试账号和内部压测账号。',
    ask: 'MAU 的统计口径是什么？',
    answer: 'MAU 统计自然月内至少登录一次的去重用户，不包含测试账号和内部压测账号。[片段1]',
    keywords: ['自然月', '去重用户', '测试账号'],
  },
  {
    department: 'procurement',
    documentType: 'procurement-policy',
    topic: '供应商准入',
    fact: '新供应商准入必须提供营业执照、对公账户证明和近一年合规承诺书，缺少任一材料不得建档。',
    ask: '新供应商准入需要哪些材料？',
    answer: '新供应商准入必须提供营业执照、对公账户证明和近一年合规承诺书，缺少任一材料不得建档。[片段1]',
    keywords: ['营业执照', '对公账户证明', '合规承诺书'],
  },
  {
    department: 'admin',
    documentType: 'office-policy',
    topic: '会议室',
    fact: '20 人以上会议必须提前 2 个工作日预订大会议室，并在会议结束后 30 分钟内恢复现场。',
    ask: '20 人以上会议室怎么预订和恢复？',
    answer: '20 人以上会议必须提前 2 个工作日预订大会议室，并在会议结束后 30 分钟内恢复现场。[片段1]',
    keywords: ['20 人', '2 个工作日', '30 分钟'],
  },
];

const variants = [
  '请按制度回答：',
  '帮我查一下：',
  '业务同学问：',
  '如果按最新规则，',
  '只基于知识库回答：',
  '给我一个可引用的结论：',
  '这条规则具体是：',
  '不要猜，文档里说：',
  '审批前确认：',
  '运营复盘里需要写：',
];

const dataset = departments.flatMap((item, departmentIndex) =>
  variants.map((prefix, variantIndex) => {
    const id = `${item.department}-${String(variantIndex + 1).padStart(2, '0')}`;
    return {
      id,
      category: variantIndex % 3 === 0 ? 'policy' : 'business-qa',
      department: item.department,
      documentType: item.documentType,
      query: `${prefix}${item.ask}`,
      referenceAnswer: item.answer,
      referenceReferences: [{ id: `${id}-reference` }],
      expectedClaims: [
        {
          text: item.answer.replace(/\[片段1\]/g, ''),
          supportKeywords: item.keywords,
        },
      ],
      expectedKeywords: item.keywords,
      minKeywordCoverage: Math.min(1, 2 / item.keywords.length),
      requireCitation: true,
      sourceDocument: {
        id: `${id}-doc`,
        title: `${item.topic} - ${item.department}`,
        content: `${item.topic}：${item.fact}`,
        referenceIndex: 1,
      },
      ordinal: departmentIndex * variants.length + variantIndex + 1,
    };
  }),
);

const payload = {
  version: '2026-06-21',
  description:
    '120 条企业业务评测样本，覆盖 HR/Finance/Legal/IT/Sales/Ops/Security/Product/CS/Data/Procurement/Admin。样本为项目内置业务回归数据，不包含真实公司私密数据。',
  total: dataset.length,
  items: dataset,
};

if (checkOnly) {
  const existing = JSON.parse(await readFile(outputPath, 'utf8'));
  const ok =
    existing.total >= 100 &&
    existing.items.length === existing.total &&
    existing.items.every(
      (item) =>
        item.query &&
        item.referenceAnswer &&
        item.requireCitation === true &&
        item.expectedClaims?.length > 0,
    );
  console.log(
    JSON.stringify(
      {
        ok,
        path: outputPath,
        total: existing.total,
        departments: [...new Set(existing.items.map((item) => item.department))],
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} else {
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    JSON.stringify({ ok: true, path: outputPath, total: payload.total }),
  );
}
