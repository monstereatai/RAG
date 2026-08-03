import http from 'node:http';
import https from 'node:https';
import { writeFile } from 'node:fs/promises';
import { safeError } from './lib/evidence-utils.mjs';

const baseUrl = process.env.RAG_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const token = process.env.ACCESS_TOKEN;
const scenario = process.argv[2] ?? 'dag';
const evidenceOutput = process.env.WORKFLOW_EVIDENCE_OUTPUT;
const runId = process.env.WORKFLOW_RUN_ID;
const runStartedAt = new Date();

if (!token) {
  console.error(
    '缺少 ACCESS_TOKEN。示例：ACCESS_TOKEN=*** npm run demo:production-workflow -- dag',
  );
  process.exit(1);
}

const scenarios = {
  single: {
    projectId: 'demo-single-frontend',
    roles: ['frontend'],
    approvalMode: 'auto',
    brief:
      '审查东南亚周年庆 H5 的组件拆分、接口状态、埋点、性能、多语言长文本和异常降级，并形成可分享的前端实施文档。',
  },
  dag: {
    projectId: 'demo-dag-collaboration',
    roles: ['product', 'design', 'frontend', 'backend', 'qa', 'operations'],
    approvalMode: 'auto',
    brief:
      '为东南亚服周年庆抽奖活动制定完整产研运方案。覆盖规则、页面状态、接口契约、库存与发奖补偿、测试门禁、灰度发布和复盘指标。支持泰语、越南语和英语，高峰五万 QPS。',
  },
  approval: {
    projectId: 'demo-selective-approval',
    roles: ['product', 'design', 'frontend', 'backend', 'qa'],
    approvalMode: 'risk_based',
    approvalRoles: ['backend', 'qa'],
    riskApprovalThreshold: 'high',
    brief:
      '正式上线前审查周年庆抽奖活动。奖励库存有限，发奖必须幂等且可补偿；后端方案和测试门禁属于关键交付物，需要负责人审批。',
  },
};

const selectedScenario = scenarios[scenario];
const payload = selectedScenario
  ? {
      ...selectedScenario,
      projectId: runId
        ? `${selectedScenario.projectId}-${runId}`
        : selectedScenario.projectId,
    }
  : undefined;
if (!payload) {
  console.error(
    `未知场景 ${scenario}，可选：${Object.keys(scenarios).join('、')}`,
  );
  process.exit(1);
}

const started = await request('/workflows/production', {
  method: 'POST',
  body: JSON.stringify(payload),
});
printState('启动', started);

let state = started;
let approvalCycles = 0;
state = await waitUntilSettled(state);
while (state.requiresApproval) {
  approvalCycles += 1;
  state = await request(`/workflows/production/${state.threadId}/resume`, {
    method: 'POST',
    body: JSON.stringify({ approval: 'approved' }),
  });
  state = await waitUntilSettled(state);
  printState('批准后继续', state);
}

if (state.status !== 'completed') {
  await saveEvidence(buildEvidence(state, false));
  console.error(`工作流未完成：${state.status} ${state.error ?? ''}`);
  process.exit(1);
}

console.log('\n交付物与证据：');
for (const role of state.selectedRoles) {
  const result = state.results[role];
  if (!result) continue;
  console.log(
    `- ${role}: ${result.deliverables.length} 个文档，证据覆盖率 ${Math.round(
      result.evidenceCoverage * 100,
    )}%，模型 ${
      result.toolExecutions.some(
        (execution) =>
          execution.tool === 'role_structured_llm' &&
          execution.status === 'success',
      )
        ? '成功'
        : '降级'
    }，审核就绪 ${
      result.readyForApproval ? '是' : '否'
    }，产物任务 ${result.generatedArtifact?.status ?? '未生成'}`,
  );
}

await saveEvidence(buildEvidence(state, true));

async function request(path, init) {
  const url = new URL(`${baseUrl}${path}`);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = init.body ?? '';
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          try {
            const body = JSON.parse(raw);
            if ((response.statusCode ?? 500) >= 400) {
              reject(
                new Error(`${response.statusCode} ${JSON.stringify(body)}`),
              );
              return;
            }
            resolve(body.data ?? body);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(10 * 60 * 1000, () => {
      req.destroy(new Error('workflow request timeout after 10 minutes'));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function printState(label, state) {
  console.log(`\n[${label}] ${state.status}`);
  console.log(`threadId=${state.threadId}`);
  console.log(
    `DAG=${state.executionBatches.map((batch) => batch.join('+')).join(' -> ')}`,
  );
  console.log(`已完成=${state.completedRoles.join('、') || '无'}`);
  if (state.pendingApprovalRoles.length > 0) {
    console.log(`待审批=${state.pendingApprovalRoles.join('、')}`);
  }
}

async function waitUntilSettled(state) {
  const deadline = Date.now() + 10 * 60 * 1000;
  let current = state;
  while (current.status === 'running') {
    if (Date.now() >= deadline) {
      throw new Error('workflow polling timeout after 10 minutes');
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    current = await request(`/workflows/production/${current.threadId}`, {
      method: 'GET',
    });
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return current;
}

function buildEvidence(state, completed) {
  const roleResults = state.selectedRoles.map((role) => {
    const result = state.results[role];
    const modelExecution = result?.toolExecutions?.find(
      (execution) => execution.tool === 'role_structured_llm',
    );
    return {
      role,
      completed: Boolean(result),
      modelStatus: modelExecution?.status ?? 'not_run',
      evidenceCoverage: result?.evidenceCoverage ?? 0,
      readyForApproval: result?.readyForApproval ?? false,
      deliverableCount: result?.deliverables?.length ?? 0,
      artifactStatus: result?.generatedArtifact?.status ?? 'not_created',
      toolExecutions: (result?.toolExecutions ?? []).map((execution) => ({
        tool: execution.tool,
        status: execution.status,
        durationMs: execution.durationMs,
      })),
    };
  });
  const endedAt = new Date();
  return {
    schemaVersion: 1,
    evidenceLevel: 'local_real_api',
    scenario,
    runId: runId ?? state.threadId,
    threadId: state.threadId,
    projectId: payload.projectId,
    startedAt: runStartedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - runStartedAt.getTime(),
    status: state.status,
    completed,
    executionBatches: state.executionBatches,
    selectedRoles: state.selectedRoles,
    completedRoles: state.completedRoles,
    pendingApprovalRoles: state.pendingApprovalRoles,
    requiresApproval: state.requiresApproval,
    approvalCycles,
    roleResults,
    error: state.error ? safeError(state.error) : undefined,
  };
}

async function saveEvidence(report) {
  if (!evidenceOutput) return;
  await writeFile(
    evidenceOutput,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(`证据已写入 ${evidenceOutput}`);
}
