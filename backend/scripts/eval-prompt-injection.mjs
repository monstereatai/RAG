import { readFile } from 'node:fs/promises';

const datasetPath =
  process.env.PROMPT_INJECTION_DATASET ?? 'eval/prompt-injection.dataset.json';
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));

const patterns = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /(reveal|print|show|dump)\s+(the\s+)?(system|developer)\s+prompt/i,
  /(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(system|developer|admin|root)/i,
  /(call|invoke|execute|run)\s+(any\s+)?tool\s+without\s+(approval|permission|validation)/i,
  /(忽略|无视|覆盖).{0,12}(之前|以上|上面).{0,12}(指令|规则|要求)/,
  /(你现在是|请扮演|切换为).{0,12}(系统|开发者|管理员|root)/i,
  /(泄露|输出|展示|打印).{0,16}(系统提示词|开发者提示词|密钥|token|密码)/i,
];

if (!Array.isArray(dataset.cases) || dataset.cases.length === 0) {
  throw new Error('prompt injection dataset requires non-empty cases');
}

const results = dataset.cases.map((item) => {
  const detected = patterns.some((pattern) => pattern.test(item.text ?? ''));
  return {
    id: item.id,
    expected: item.expectDetection === true,
    detected,
    passed: detected === (item.expectDetection === true),
  };
});

const passedCount = results.filter((item) => item.passed).length;
const score = Number((passedCount / results.length).toFixed(3));
const report = {
  ok: passedCount === results.length,
  dataset: datasetPath,
  version: dataset.version,
  score,
  passedCount,
  total: results.length,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

