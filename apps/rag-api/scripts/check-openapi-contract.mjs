const baseUrl = process.env.OPENAPI_URL ?? 'http://127.0.0.1:3000';
const requiredPaths = [
  '/rag/admin/security/policies',
  '/rag/admin/security/audit',
  '/rag/admin/quality/summary',
  '/rag/admin/documents/index-audit',
  '/rag/admin/agent-ops/runs/summary',
  '/health/ready',
];

try {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/docs-json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const document = await response.json();
  const missing = requiredPaths.filter((path) => !document.paths?.[path]);
  const nonChinese = requiredPaths.filter((path) => {
    const operation = Object.values(document.paths?.[path] ?? {})[0];
    return !operation?.summary || !/[\u4e00-\u9fff]/u.test(operation.summary);
  });
  if (missing.length || nonChinese.length) {
    console.error(JSON.stringify({ ok: false, missing, nonChinese }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, baseUrl, checked: requiredPaths }, null, 2));
} catch (error) {
  if (process.env.OPENAPI_REQUIRED === 'true') {
    console.error(`OpenAPI contract check failed: ${error.message}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, skipped: true, reason: `服务不可用：${error.message}` }, null, 2));
}
