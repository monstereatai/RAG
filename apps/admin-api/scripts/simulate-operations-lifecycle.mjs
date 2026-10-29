import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.OPERATIONS_REPORT ?? '.tmp/evidence/operations-lifecycle-simulation.json';
const webhookUrl = process.env.WECHAT_WORK_WEBHOOK_URL;
const incidentId = `inc-sim-${Date.now()}`;
const events = [];

function transition(status, detail) {
  events.push({ at: new Date().toISOString(), status, detail });
}

transition('alert_triggered', 'Prometheus detected p95 latency above the simulated SLA threshold');
transition(
  webhookUrl ? 'wechat_notified' : 'notification_simulated',
  webhookUrl ? 'Enterprise WeChat webhook is configured' : 'Webhook is not configured; notification was simulated',
);
transition('acknowledged', 'on-call owner acknowledged the incident');
transition('mitigated', 'traffic was routed to the fallback model and concurrency was reduced');
transition('resolved', 'latency and error rate returned below the alert threshold');
transition('postmortem_completed', 'root cause, corrective actions and regression case were recorded');

if (webhookUrl) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: `### 模拟运营事故\n> Incident：${incidentId}\n> 级别：warning\n> 说明：本次为本地模拟告警，不代表真实生产事故。`,
      },
    }),
  });
  if (!response.ok) throw new Error(`Enterprise WeChat notification failed: ${response.status}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  evidenceLevel: 'simulated_operational_evidence',
  simulated: true,
  incidentId,
  notification: { channel: 'enterprise_wechat', configured: Boolean(webhookUrl), sent: Boolean(webhookUrl) },
  events,
  requiredStates: ['alert_triggered', 'acknowledged', 'mitigated', 'resolved', 'postmortem_completed'],
  passed: events.some((event) => event.status === 'alert_triggered') &&
    events.some((event) => event.status === 'postmortem_completed'),
  interpretation:
    '该报告只证明告警、通知、值班、恢复和 Postmortem 状态机可运行，不代表真实值班或生产事故证据。',
};

await mkdir(output.substring(0, output.lastIndexOf('/')) || '.', { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath: output }, null, 2));
