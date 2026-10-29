const baseUrl = (
  process.env.LANGFUSE_SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');
const username = process.env.LANGFUSE_SMOKE_USERNAME ?? 'user';
const password = process.env.LANGFUSE_SMOKE_PASSWORD ?? 'user1234';

const login = await fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const loginBody = await login.json();
if (!login.ok) {
  throw new Error(`LangFuse smoke login failed: ${login.status}`);
}
const token = loginBody?.data?.accessToken ?? loginBody?.accessToken;
if (!token) throw new Error('LangFuse smoke login returned no access token');

const headers = { authorization: `Bearer ${token}` };
const statusResponse = await fetch(`${baseUrl}/observability/langfuse/status`, {
  headers,
});
const statusBody = await statusResponse.json();
if (!statusResponse.ok) {
  throw new Error(`LangFuse status failed: ${statusResponse.status}`);
}
const status = statusBody?.data ?? statusBody;
if (
  typeof status.enabled !== 'boolean' ||
  typeof status.hasPublicKey !== 'boolean' ||
  typeof status.hasSecretKey !== 'boolean'
) {
  throw new Error('LangFuse status contract is invalid');
}
const healthResponse = await fetch(`${baseUrl}/observability/langfuse/health`, {
  headers,
});
const healthBody = await healthResponse.json();
if (!healthResponse.ok) {
  throw new Error(`LangFuse health failed: ${healthResponse.status}`);
}
let health = healthBody?.data ?? healthBody;
if (
  typeof health.enabled !== 'boolean' ||
  typeof health.healthy !== 'boolean' ||
  typeof health.tracesSent !== 'number'
) {
  throw new Error('LangFuse health contract is invalid');
}

const smokeResponse = await fetch(`${baseUrl}/observability/langfuse/smoke`, {
  method: 'POST',
  headers,
});
const smokeBody = await smokeResponse.json();
if (!smokeResponse.ok) {
  throw new Error(`LangFuse smoke failed: ${smokeResponse.status}`);
}
const smoke = smokeBody?.data ?? smokeBody;
const postHealthResponse = await fetch(`${baseUrl}/observability/langfuse/health`, {
  headers,
});
const postHealthBody = await postHealthResponse.json();
health = postHealthBody?.data ?? postHealthBody;
const expectedDisabled = !status.enabled;
const passed =
  typeof smoke.enabled === 'boolean' &&
  typeof smoke.sent === 'boolean' &&
  (expectedDisabled ? smoke.sent === false : smoke.sent === true);

const report = {
  generatedAt: new Date().toISOString(),
  evidenceLevel: status.enabled ? 'local_configured_api' : 'local_disabled_contract',
  status: {
    enabled: status.enabled,
    baseUrl: status.baseUrl,
    hasPublicKey: status.hasPublicKey,
    hasSecretKey: status.hasSecretKey,
  },
  health,
  smoke,
  passed,
};
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
