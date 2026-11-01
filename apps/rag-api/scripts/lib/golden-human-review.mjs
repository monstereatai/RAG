/** A two-phase, non-automated review handoff. No model or scorer sets human labels. */
import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty = (x) => typeof x === 'string' && x.trim() === x && x.length > 0;
const arr = (x) => Array.isArray(x) ? x : [];

export function makeReviewSheet(dataset, draft) {
  if (dataset?.synthetic !== false || draft?.source !== 'real_api') {
    throw new Error('Only non-synthetic dataset + real API capture may be submitted to review');
  }
  if (!arr(dataset.cases).length || draft.datasetHash !== digest(dataset) ||
      draft.failures?.length || !Number.isFinite(Date.parse(draft.runCaptureTime)) ||
      draft.readyForReview !== true ||
      arr(draft.runs).length !== dataset.cases.length) {
    throw new Error('Capture is incomplete or not bound to frozen dataset');
  }
  const byId = new Map(draft.runs.map(r => [r.caseId, r]));
  if (byId.size !== dataset.cases.length) throw new Error('Duplicate or missing capture run');
  return {
    schemaVersion: 1, kind: 'human-golden-review-sheet', datasetHash: draft.datasetHash,
    captureHash: digest(draft),
    instructions: 'Human reviewers MUST open the original source and captured answer/trace, fill all fields. Do not pre-approve. Never commit this private sheet.',
    decisions: dataset.cases.map(test => {
      const run = byId.get(test.id);
      if (!run || !nonempty(run.runId)) throw new Error(`Missing real runId for ${test.id}`);
      return { caseId: test.id, runId: run.runId, reviewerId: '', reviewedAt: null,
        approved: null, correct: null, citationsSupported: null, notes: '',
        check: { kind: test.kind, split: test.split, scenario: test.scenario,
          expectedDocIds: test.expectedDocIds, expectedChunkIds: test.expectedChunkIds ?? [],
          expectedEvents: test.expectedEvents ?? [], expectedClaims: test.expectedClaims ?? [],
          sourceUri: test.sourceUri, sourceHash: test.sourceHash },
      };
    }),
  };
}

export function finalizeHumanReview(dataset, draft, sheet) {
  const expected = makeReviewSheet(dataset, draft);
  if (sheet?.kind !== expected.kind || sheet.datasetHash !== expected.datasetHash ||
      sheet.captureHash !== expected.captureHash || !Array.isArray(sheet.decisions) ||
      sheet.decisions.length !== expected.decisions.length) {
    throw new Error('Review sheet is stale/incomplete; dataset or capture was modified');
  }
  const byId = new Map();
  for (const decision of sheet.decisions) {
    if (!nonempty(decision?.caseId) || byId.has(decision.caseId)) throw new Error('Duplicate/missing review caseId');
    byId.set(decision.caseId, decision);
  }
  const runById = new Map(draft.runs.map(x => [x.caseId, x]));
  const result = dataset.cases.map(test => {
    const decision = byId.get(test.id);
    const run = runById.get(test.id);
    if (!decision || !run || run.runId !== decision.runId) throw new Error(`Review run identity mismatch: ${test.id}`);
    if (!nonempty(decision.reviewerId) || decision.reviewerId === test.review?.reviewerId) {
      throw new Error(`${test.id}: post-run reviewer must be a distinct, identified person from source reviewer`);
    }
    if (!Number.isFinite(Date.parse(decision.reviewedAt)) ||
        Date.parse(decision.reviewedAt) < Date.parse(draft.runCaptureTime)) {
      throw new Error(`${test.id}: review timestamp must follow actual API capture`);
    }
    if (decision.approved !== true || typeof decision.correct !== 'boolean' ||
        typeof decision.citationsSupported !== 'boolean') {
      throw new Error(`${test.id}: explicit human approval and boolean correctness/citation decisions required`);
    }
    if ((!decision.correct || !decision.citationsSupported) && !nonempty(decision.notes)) {
      throw new Error(`${test.id}: failed human review requires reason in notes`);
    }
    // Never copy answers, source snippets or full references into release evidence.
    const { caseId, runId, status, durationMs, retrievedDocIds,
      retrievedChunkIds, citedDocIds, retrievedVersions, refused, events, mode } = run;
    return { caseId, runId, status, durationMs, retrievedDocIds, retrievedChunkIds,
      citedDocIds, retrievedVersions, refused, events, mode,
      humanReview: { approved: true, reviewerId: decision.reviewerId,
        reviewedAt: decision.reviewedAt, correct: decision.correct,
        citationsSupported: decision.citationsSupported },
    };
  });
  if (new Set(result.map(x => x.runId)).size !== result.length) throw new Error('Different cases cannot share the same runId');
  return {
    schemaVersion: 1, source: 'real_api', datasetHash: digest(dataset),
    captureHash: digest(draft), reviewHash: digest(sheet), runCaptureTime: draft.runCaptureTime,
    failures: [], runs: result,
  };
}
