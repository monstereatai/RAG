const baseUrl = (
  process.env.DINGTALK_SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');
const username = process.env.DINGTALK_SMOKE_USERNAME ?? 'user';
const password = process.env.DINGTALK_SMOKE_PASSWORD ?? 'user1234';

const login = await fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const loginBody = await login.json();
if (!login.ok) {
  throw new Error(`DingTalk smoke login failed: ${login.status}`);
}
const token = loginBody?.data?.accessToken ?? loginBody?.accessToken;
if (!token) throw new Error('DingTalk smoke login returned no access token');

const headers = { authorization: `Bearer ${token}` };
const statusResponse = await fetch(`${baseUrl}/observability/dingtalk/status`, {
  headers,
});
const statusBody = await statusResponse.json();
if (!statusResponse.ok) {
  throw new Error(`DingTalk status failed: ${statusResponse.status}`);
}
const status = statusBody?.data ?? statusBody;
if (
  typeof status.enabled !== 'boolean' ||
  typeof status.alertCooldownMs !== 'number' ||
  !Array.isArray(status.forwardThreadIds)
) {
  throw new Error('DingTalk status contract is invalid');
}

const smokeResponse = await fetch(`${baseUrl}/observability/dingtalk/smoke`, {
  method: 'POST',
  headers,
});
const smokeBody = await smokeResponse.json();
if (!smokeResponse.ok) {
  throw new Error(`DingTalk smoke failed: ${smokeResponse.status}`);
}
const smoke = smokeBody?.data ?? smokeBody;

const healthResponse = await fetch(`${baseUrl}/observability/dingtalk/health`, {
  headers,
});
const healthBody = await healthResponse.json();
if (!healthResponse.ok) {
  throw new Error(`DingTalk health failed: ${healthResponse.status}`);
}
const health = healthBody?.data ?? healthBody;
if (
  typeof health.enabled !== 'boolean' ||
  typeof health.healthy !== 'boolean' ||
  typeof health.messagesSent !== 'number'
) {
  throw new Error('DingTalk health contract is invalid');
}

const expectedDisabled = !status.enabled;
const passed =
  typeof smoke.enabled === 'boolean' &&
  typeof smoke.sent === 'boolean' &&
  (expectedDisabled ? smoke.sent === false : smoke.sent === true);

const report = {
  generatedAt: new Date().toISOString(),
  evidenceLevel: status.enabled
    ? 'remote_configured_webhook'
    : 'local_disabled_contract',
  status: {
    enabled: status.enabled,
    alertCooldownMs: status.alertCooldownMs,
    forwardThreadIds: status.forwardThreadIds,
  },
  health,
  smoke,
  passed,
};
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
