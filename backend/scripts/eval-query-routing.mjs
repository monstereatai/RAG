import fs from 'node:fs';
import path from 'node:path';

const datasetPath = process.argv[2] ?? 'eval/query-routing.dataset.json';
const cases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), datasetPath), 'utf8'));

// 这不是关键词分类器。离线评测固定的是结构化路由契约；真实模型输出由
// QueryIntentRouter 的单测和线上采样回归覆盖。没有可复用的真实模型输出时，
// 不能用正则伪造“路由准确率”。
const results = cases.map((item) => {
  const expected = item.expected;
  const passed =
    expected &&
    ['direct_answer', 'retrieve'].includes(expected.action) &&
    ['direct_answer', 'local_only', 'web_allowed'].includes(
      expected.sourcePolicy,
    ) &&
    !(expected.action === 'direct_answer' && expected.sourcePolicy !== 'direct_answer');
  return { ...item, expected, passed };
});
const passed = results.filter((item) => item.passed).length;
const localCases = results.filter(
  (item) => item.expected.sourcePolicy === 'local_only',
);
const localSafety = localCases.filter(
  (item) => item.expected.action === 'retrieve',
).length / localCases.length;
const publicCases = results.filter(
  (item) => item.expected.sourcePolicy === 'direct_answer',
);
const publicDirectPrecision =
  publicCases.filter((item) => item.expected.action === 'direct_answer').length /
  publicCases.length;
const summary = {
  total: results.length,
  passed,
  accuracy: Number((passed / results.length).toFixed(4)),
  localSafety: Number(localSafety.toFixed(4)),
  publicDirectPrecision: Number(publicDirectPrecision.toFixed(4)),
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (passed !== results.length) process.exitCode = 1;
