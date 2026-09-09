import fs from 'node:fs';
import path from 'node:path';

const datasetPath = process.argv[2] ?? 'eval/query-routing.dataset.json';
const cases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), datasetPath), 'utf8'));

function requiresRetrieval(query) {
  if (!query.trim()) return true;
  if ((query.match(/[？?]/g) ?? []).length > 1) return true;
  if (/(公司|项目|部门|团队|内部|知识库|文档|制度|员工|同事|客户|用户|业务|活动|接口|系统|当前|我们|上传|资料|数据库|配置|线上|版本|数据)/i.test(query)) return true;
  if (/(是谁|什么人|哪个人|叫什么|做了什么|属于哪个|在哪个部门)/i.test(query)) return true;
  return /(上次|刚才|前面|这个|那个|上述|继续|再说|今天|最新|当前)/i.test(query);
}

const results = cases.map((item) => {
  const predicted = requiresRetrieval(item.query) ? 'retrieve' : 'direct_answer';
  return { ...item, predicted, passed: predicted === item.expectedAction };
});
const passed = results.filter((item) => item.passed).length;
const privateCases = results.filter((item) => item.mustRetrieve);
const privateRecall = privateCases.filter((item) => item.predicted === 'retrieve').length / privateCases.length;
const publicCases = results.filter((item) => !item.mustRetrieve);
const publicPrecision = publicCases.filter((item) => item.predicted === 'direct_answer').length / publicCases.length;
const summary = {
  total: results.length,
  passed,
  accuracy: Number((passed / results.length).toFixed(4)),
  privateRecall: Number(privateRecall.toFixed(4)),
  publicDirectPrecision: Number(publicPrecision.toFixed(4)),
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (passed !== results.length) process.exitCode = 1;
