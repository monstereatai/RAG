const baseUrl = (process.env.RAG_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const serviceToken = process.env.RAG_SERVICE_TOKEN ?? 'local-rag-service-token';
const windowDays = Number(process.env.ADOPTION_WINDOW_DAYS ?? 30);

const response = await fetch(
  `${baseUrl}/rag/ops-api/qa/adoption-summary?windowDays=${windowDays}`,
  { headers: { Authorization: `Bearer ${serviceToken}` } },
);
const body = await response.json();
if (!response.ok) throw new Error(`adoption summary failed: ${response.status}`);
const envelope = body?.data ?? body;
const result = envelope?.data ?? envelope;
const required = [
  'windowDays',
  'status',
  'activeUsers',
  'repeatUsers',
  'totalQueries',
  'answerRate',
  'feedbackCoverage',
  'positiveFeedbackRate',
];
const valid =
  required.every((key) => key in result) &&
  ['measured', 'insufficient_real_traffic'].includes(result.status);
const report = {
  generatedAt: new Date().toISOString(),
  evidenceLevel: result.status === 'measured' ? 'local_real_api' : 'awaiting_real_traffic',
  result,
  passed: valid,
};
console.log(JSON.stringify(report, null, 2));
if (!valid) process.exitCode = 1;
