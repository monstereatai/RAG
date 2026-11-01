import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReleaseGate } from './verified-golden.mjs';

function report(agentRate) {
  return {
    ok: true,
    measured: true,
    summary: {
      holdout: {
        cases: 20,
        passRate: 0.95,
        recallAtK: 0.85,
        aclViolations: 0,
        p95Ms: 7000,
        byKind: {
          rag: { cases: 10, passRate: 0.9, recallAtK: 0.85, aclViolations: 0 },
          agent: { cases: 10, passRate: agentRate, trajectoryPassRate: agentRate },
        },
      },
    },
  };
}

test('release gate blocks poor Agent outcomes even if aggregate metrics look good', () => {
  const result = applyReleaseGate(report(0.5));
  assert.equal(result.approved, false);
  assert.match(result.errors.join(' '), /agent.*passRate/i);
});

test('release gate requires both Agent and RAG holdout cases', () => {
  const value = report(1);
  value.summary.holdout.byKind.agent.cases = 0;
  const result = applyReleaseGate(value);
  assert.equal(result.approved, false);
  assert.match(result.errors.join(' '), /agent.*holdout/i);
});

test('release gate accepts independently passing Agent and RAG metrics', () => {
  assert.equal(applyReleaseGate(report(0.98)).approved, true);
});
