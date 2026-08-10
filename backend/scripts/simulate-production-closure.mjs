import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.PRODUCTION_CLOSURE_REPORT ?? '.tmp/evidence/production-closure-simulation.json';

const businessData = {
  evidenceLevel: 'simulated_business_evidence',
  simulated: true,
  documents: 20,
  questions: 100,
  goldenAnswers: 100,
  expectedCitations: 100,
  badCaseRegression: {
    cases: 20,
    beforePassRate: 0.68,
    afterPassRate: 0.94,
    modes: ['simple', 'auto', 'agentic'],
  },
  passed: true,
  integrationNotes: [
    '接入真实脱敏文档、标准答案、期望引用和真实长期 Bad Case 数据集。',
  ],
};

const highAvailability = {
  simulated: true,
  instances: 2,
  sse: {
    eventsProduced: 12,
    lastEventId: '12',
    disconnectedAfter: '8',
    replayedAfterReconnect: ['9', '10', '11', '12'],
    passed: true,
  },
  checkpoint: { writer: 'instance-a', reader: 'instance-b', recovered: true },
  workers: { clusterSize: 2, completed: 19, failed: 1, retried: 1 },
  deadLetter: { queued: 1, replayed: 1, remaining: 0 },
  passed: true,
  integrationNotes: [
    '接入 Kubernetes／Docker 多副本编排和共享事件日志，才能验证真实 SSE 断线续传。',
    '接入独立 Worker 集群、生产死信队列和跨服务补偿策略。',
  ],
};

const multimodal = {
  simulated: true,
  image: { ocr: true, embedding: true, imageToSearch: true },
  video: { durationSeconds: 120, extractedFrames: 8, transcript: true },
  retrieval: { textToImage: true, imageToText: true, crossModalRerank: true },
  citations: ['image-001#page-1', 'video-001#00:32'],
  passed: true,
  integrationNotes: [
    '接入真实视觉 Embedding、视频抽帧模型和跨模态 Reranker。',
    '用真实图片、视频和人工标注结果复测 Recall、引用定位和误召回率。',
  ],
};

const compliance = {
  simulated: true,
  identity: { users: 50, roles: 6, deniedCrossTenantReads: 12, passed: true },
  classification: { public: 10, internal: 7, confidential: 3, passed: true },
  redaction: { email: 18, phone: 11, idNumber: 4, passed: true },
  deletion: { requestId: 'delete-sim-001', postgres: true, redis: true, vectorIndex: true, passed: true },
  retention: { defaultDays: 30, expiredArtifactsRemoved: 6, passed: true },
  passed: true,
  integrationNotes: [
    '接入企业 IAM／SSO、组织同步和真实租户权限源。',
    '接入企业 DLP、数据分级、审批和合规审计平台。',
  ],
};

const costGovernance = {
  simulated: true,
  pricing: { source: 'simulated_model_price', currency: 'USD', inputPer1k: 0.001, outputPer1k: 0.002 },
  tenants: [
    { tenantId: 'tenant-a', monthlyQuotaUsd: 50, usedUsd: 31.4, alert: false },
    { tenantId: 'tenant-b', monthlyQuotaUsd: 20, usedUsd: 21.8, alert: true, action: 'fallback_and_limit_output' },
  ],
  settlement: { month: 'simulated', totalUsd: 53.2, invoicesGenerated: 2 },
  passed: true,
  integrationNotes: [
    '接入真实模型价格配置和供应商账单校验。',
    '接入租户配额中心、支付／结算系统和成本告警渠道。',
  ],
};

const operations = {
  simulated: true,
  incidentId: 'inc-sim-production-closure',
  timeline: [
    'alert_triggered',
    'wechat_notified_or_simulated',
    'on_call_acknowledged',
    'mitigated',
    'resolved',
    'postmortem_completed',
    'regression_case_created',
  ],
  notificationEntryPoint: 'NotifyService.sendOperationsAlert',
  passed: true,
  integrationNotes: [
    '接入钉钉通知 API作为备用渠道。',
    '接入飞书／PagerDuty／企业值班系统，实现真实轮值和升级策略。',
    'LangFuse 基础接入已完成；仍需配置生产 Dashboard、Alertmanager、告警规则、采样脱敏和长期留存。',
  ],
};

const userEffects = {
  simulated: true,
  activeUsers: 50,
  repeatUsers: 34,
  totalQueries: 800,
  adoptionRate: 0.761,
  reworkRate: 0.12,
  humanTakeoverRate: 0.061,
  savedHours: 39.31,
  sla: { targetMs: 3000, p50: 1780, p95: 2621, p99: 4634, p95Pass: true },
  passed: true,
  integrationNotes: [
    '接入真实用户行为、反馈、返工、人工接管和工时数据。',
    '在真实流量和目标机器上持续观测长期采纳率与 SLA。',
  ],
};

const sections = { businessData, highAvailability, multimodal, compliance, costGovernance, operations, userEffects };
const report = {
  generatedAt: new Date().toISOString(),
  evidenceLevel: 'simulated_production_closure',
  simulated: true,
  sections,
  passed: Object.values(sections).every((section) => section.passed === true),
  boundary: '所有数字和状态均为本地模拟证据，不代表真实业务、真实生产 SLA、真实值班或真实账单。',
};

await mkdir(output.substring(0, output.lastIndexOf('/')) || '.', { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath: output }, null, 2));
