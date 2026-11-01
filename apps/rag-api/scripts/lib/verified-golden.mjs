/**
 * Reviewed production Golden Set — strict offline contract and scoring.
 * Never infer factual correctness from keyword overlaps or a Judge's score.
 * This module does not access private corpora or external services.
 */
import { createHash } from 'node:crypto';

const types = new Set(['rag', 'agent']);
const splits = new Set(['development', 'holdout']);
const requiredBuckets = new Set(['direct', 'cross_document', 'version', 'acl', 'refusal', 'tool_failure', 'checkpoint_resume']);
const normalId = (value) => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const unique = (items) => new Set(items).size === items.length;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const array = (value) => Array.isArray(value) ? value : [];
const clamp = (x) => Math.round(x * 10_000) / 10_000;

export function validateGoldenDataset(input, { production = false, minHoldout = 1, minCases = 1 } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['dataset must be an object'];
  if (!normalId(input.datasetId) || !normalId(input.version)) errors.push('datasetId and version required');
  if (!Array.isArray(input.cases) || input.cases.length < minCases) errors.push(`at least ${minCases} cases required`);
  if (production && input.synthetic !== false) errors.push('production gate forbids synthetic/unreviewed dataset');
  const seen = new Set();
  let holdoutCount = 0;
  const bucketSet = new Set();
  for (const [i, item] of array(input.cases).entries()) {
    const p = `cases[${i}]`;
    if (!normalId(item?.id) || seen.has(item.id)) errors.push(`${p}: missing/duplicate id`);
    if (normalId(item?.id)) seen.add(item.id);
    if (!types.has(item?.kind) || !splits.has(item?.split)) errors.push(`${p}: invalid kind/split`);
    if (item?.split === 'holdout') holdoutCount++;
    if (!normalId(item?.scenario)) errors.push(`${p}: scenario required`);
    else bucketSet.add(item.scenario);
    if (!normalId(item?.question)) errors.push(`${p}: question required`);
    const reviewer = item?.review;
    if (!reviewer || reviewer.approved !== true || !normalId(reviewer.reviewerId) ||
        !Number.isFinite(Date.parse(reviewer.reviewedAt)) || !normalId(reviewer.sourceRevision)) {
      errors.push(`${p}: independent human review (approved/reviewerId/reviewedAt/sourceRevision) required`);
    }
    if (!Array.isArray(item?.expectedDocIds) || !unique(item.expectedDocIds) || item.expectedDocIds.some(x => !normalId(x))) errors.push(`${p}: expectedDocIds must be unique IDs`);
    if (!Array.isArray(item?.forbiddenDocIds) || !unique(item.forbiddenDocIds) || item.forbiddenDocIds.some(x => !normalId(x))) errors.push(`${p}: forbiddenDocIds must be unique IDs`);
    if (array(item?.expectedDocIds).some(id => array(item?.forbiddenDocIds).includes(id))) errors.push(`${p}: expected and forbidden documents overlap`);
    if (item?.expectRefusal !== true && array(item?.expectedDocIds).length === 0 && item?.kind === 'rag') errors.push(`${p}: RAG positive requires expectedDocIds`);
    if (item?.expectRefusal === true && array(item?.expectedDocIds).length !== 0) errors.push(`${p}: refusal must not declare expectedDocIds`);
    if (item?.scenario === 'acl' && !array(item?.forbiddenDocIds).length) errors.push(`${p}: ACL scenario requires forbiddenDocIds`);
    if (item?.scenario === 'refusal' && item?.expectRefusal !== true) errors.push(`${p}: refusal scenario must require refusal`);
    if (['checkpoint_resume','tool_failure'].includes(item?.scenario) && item?.kind !== 'agent') errors.push(`${p}: scenario requires Agent kind`);
    if (item?.kind === 'agent' && !array(item?.expectedEvents).length) errors.push(`${p}: agent expectedEvents required`);
    if (item?.kind === 'agent' && !Array.isArray(item?.forbiddenEvents)) errors.push(`${p}: forbiddenEvents required`);
    if (item?.scenario === 'version' && (!item?.expectedVersions || Object.keys(item.expectedVersions).length === 0)) errors.push(`${p}: version scenario requires expectedVersions`);
    if (item?.kind === 'rag' && !Array.isArray(item?.expectedClaims)) errors.push(`${p}: expectedClaims array required`);
    if (production && item?.kind === 'rag' && !item?.expectRefusal && (!Array.isArray(item.expectedChunkIds) || !item.expectedChunkIds.length)) errors.push(`${p}: production answerable RAG needs human-labeled expectedChunkIds`);
    if (item?.kind === 'rag' && !item.expectRefusal && !array(item.expectedClaims).length) errors.push(`${p}: answerable RAG requires reviewed expectedClaims`);
    for (const claim of array(item?.expectedClaims)) if (!normalId(claim)) errors.push(`${p}: empty expected claim`);
    if (production && !/^[0-9a-f]{64}$/i.test(item?.sourceHash ?? '')) errors.push(`${p}: SHA-256 of source snapshot required`);
    if (production && !normalId(item?.sourceUri)) errors.push(`${p}: stable sourceUri required`);
  }
  if (production && holdoutCount < minHoldout) errors.push(`production gate requires >=${minHoldout} reviewed holdout cases`);
  if (production && ![...requiredBuckets].every(b => bucketSet.has(b))) errors.push(`production gate missing scenarios: ${[...requiredBuckets].filter(b => !bucketSet.has(b)).join(',')}`);
  return errors;
}

function sequenceMatches(events, expected) {
  let cursor = 0;
  for (const type of expected) {
    const pos = events.findIndex((event, idx) => idx >= cursor && event.eventType === type);
    if (pos < 0) return false;
    cursor = pos + 1;
  }
  return true;
}
function rankingMetric(expected, retrieved, k) {
  if (!expected.length) return { recall: null, mrr: null, ndcg: null };
  const top = retrieved.slice(0, k);
  const relevant = new Set(expected);
  const found = new Set(top.filter(id => relevant.has(id)));
  const recall = found.size / relevant.size;
  const rank = top.findIndex(id => relevant.has(id));
  const mrr = rank < 0 ? 0 : 1 / (rank + 1);
  const dcg = top.reduce((sum, id, i) => sum + (relevant.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = [...relevant].slice(0, k).reduce((sum, _id, i) => sum + 1 / Math.log2(i + 2), 0);
  return { recall: clamp(recall), mrr: clamp(mrr), ndcg: clamp(dcg / ideal) };
}
function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? clamp(finite.reduce((a,b) => a+b, 0) / finite.length) : null;
}
export function scoreGoldenDataset(dataset, observations, { k = 5, production = false, minHoldout = 1, minCases = 1 } = {}) {
  const errors = validateGoldenDataset(dataset, {production, minHoldout, minCases});
  if (production && observations?.datasetHash !== sha256(JSON.stringify(dataset))) errors.push('observations.datasetHash must match exact reviewed dataset snapshot');
  const runs = observations?.runs;
  if (!Array.isArray(runs)) errors.push('observations.runs array required');
  const byId = new Map();
  for (const run of array(runs)) {
    if (!normalId(run?.caseId) || byId.has(run.caseId)) errors.push(`observations: missing/duplicate caseId ${run?.caseId}`);
    else byId.set(run.caseId, run);
  }
  const ids = new Set(array(dataset?.cases).map(c => c?.id));
  for (const caseId of byId.keys()) if (!ids.has(caseId)) errors.push(`observations: unknown caseId ${caseId}`);
  if (!Number.isInteger(k) || k < 1 || k > 100) errors.push('k must be 1..100');
  if (errors.length) return { ok: false, measured: false, errors, results: [], summary: null };
  const results = [];
  for (const test of dataset.cases) {
    const run = byId.get(test.id);
    if (!run) { errors.push(`${test.id}: no actual observation; cannot mark passed`); continue; }
    if (!normalId(run.runId) || !Number.isFinite(run.durationMs) || run.durationMs < 0) {
      errors.push(`${test.id}: runId and nonnegative durationMs required`); continue;
    }
    const retrieved = array(run.retrievedDocIds);
    const cited = array(run.citedDocIds);
    const retrievedChunks = array(run.retrievedChunkIds);
    if (production && test.kind === 'rag' && !Array.isArray(run.retrievedChunkIds)) {errors.push(`${test.id}: actual retrievedChunkIds required`);continue;}
    if (!Array.isArray(run.retrievedDocIds) || !Array.isArray(run.citedDocIds) ||
        !unique(retrieved) || retrieved.some(x => !normalId(x)) || cited.some(x => !normalId(x))) {
      errors.push(`${test.id}: retrievedDocIds and citedDocIds must be actual ID arrays`); continue;
    }
    // Claims are evaluated only by an independent reviewer. A Judge is supplementary;
    // merely returning a string or keywords is NOT evidence of correctness.
    const human = run.humanReview;
    if (!human || human.approved !== true || !normalId(human.reviewerId) ||
        !Number.isFinite(Date.parse(human.reviewedAt)) || typeof human.correct !== 'boolean' ||
        typeof human.citationsSupported !== 'boolean') {
      errors.push(`${test.id}: independent human observation review required`); continue;
    }
    const denied = new Set(test.forbiddenDocIds);
    const leak = [...retrieved, ...cited].some(id => denied.has(id));
    const m = rankingMetric(test.expectedDocIds, retrieved, k);
    const c = rankingMetric(array(test.expectedChunkIds), retrievedChunks, k);
    const chunkPrec = array(test.expectedChunkIds).length && retrievedChunks.length
      ? clamp(retrievedChunks.slice(0,k).filter(id=>test.expectedChunkIds.includes(id)).length / Math.min(k,retrievedChunks.length)) : null;
    const actualVersions = run.retrievedVersions ?? {};
    const versionOkay = Object.entries(test.expectedVersions ?? {}).every(([id,version])=> actualVersions[id] === version);
    const didRefuse = run.refused === true;
    const denialOkay = test.expectRefusal === true ? didRefuse && cited.length === 0 : !didRefuse;
    const citationsOkay = human.citationsSupported && cited.every(id => retrieved.includes(id)) &&
      (test.kind !== 'rag' || test.expectRefusal === true || cited.length > 0);
    const evidenceOkay = test.expectRefusal === true || test.kind === 'agent' || m.recall > 0;
    const events = array(run.events);
    const trajectoryOkay = test.kind !== 'agent' || (
      Array.isArray(run.events) && events.every(e => normalId(e?.eventType)) &&
      sequenceMatches(events, test.expectedEvents) &&
      !events.some(e => test.forbiddenEvents.includes(e.eventType)) &&
      !events.some(e => e.eventType === 'tool.unknown' && run.reconciledUnknown !== true)
    );
    const pass = human.correct && !leak && denialOkay && citationsOkay && evidenceOkay && trajectoryOkay && versionOkay && run.status === 'completed';
    results.push({caseId: test.id, kind: test.kind, split: test.split, scenario: test.scenario, runId: run.runId,
      passed: Boolean(pass), durationMs: run.durationMs, recallAtK: m.recall, mrr: m.mrr, ndcg: m.ndcg,
      chunkRecallAtK:c.recall, contextPrecisionAtK:chunkPrec, versionCorrect:versionOkay,
      aclViolated: leak, refusalCorrect: denialOkay, citationSupported: citationsOkay,
      trajectoryCorrect: trajectoryOkay, humanCorrect: human.correct });
  }
  if (errors.length) return {ok:false,measured:false,errors,results,summary:null};
  const groups = {};
  for (const split of ['development','holdout']) {
    const scoped = results.filter(x => x.split === split);
    const sorted = scoped.map(x=>x.durationMs).sort((a,b)=>a-b);
    const ragCases = scoped.filter(x => x.kind === 'rag');
    const agentCases = scoped.filter(x => x.kind === 'agent');
    groups[split] = {cases:scoped.length, passRate:average(scoped.map(x=>Number(x.passed))),
      byKind: {
        rag: { cases: ragCases.length, passRate: average(ragCases.map(x=>Number(x.passed))),
          recallAtK: average(ragCases.map(x=>x.recallAtK)),
          citationSupportedRate: average(ragCases.map(x=>Number(x.citationSupported))),
          aclViolations: ragCases.filter(x=>x.aclViolated).length },
        agent: { cases: agentCases.length, passRate: average(agentCases.map(x=>Number(x.passed))),
          trajectoryPassRate: average(agentCases.map(x=>Number(x.trajectoryCorrect))) },
      },
      recallAtK:average(scoped.map(x=>x.recallAtK)), mrr:average(scoped.map(x=>x.mrr)),
      ndcg:average(scoped.map(x=>x.ndcg)), contextPrecisionAtK:average(scoped.map(x=>x.contextPrecisionAtK)),
      chunkRecallAtK:average(scoped.map(x=>x.chunkRecallAtK)), aclViolations:scoped.filter(x=>x.aclViolated).length,
      p95Ms:sorted.length ? sorted[Math.ceil(sorted.length*0.95)-1] : null};
  }
  return {ok:true, measured:true, errors:[], datasetHash:sha256(JSON.stringify(dataset)),
    observationHash:sha256(JSON.stringify(observations)), k, results, summary:groups};
}

export function applyReleaseGate(report, { minHoldoutPassRate = 0.9, minHoldoutRecall = 0.8, minAgentPassRate = 0.95, maxP95Ms = 30_000 } = {}) {
  const errors = [];
  if (!Number.isFinite(minAgentPassRate) || minAgentPassRate < 0 || minAgentPassRate > 1) errors.push('invalid Agent threshold');
  if (!Number.isFinite(minHoldoutPassRate) || minHoldoutPassRate < 0 || minHoldoutPassRate > 1 ||
      !Number.isFinite(minHoldoutRecall) || minHoldoutRecall < 0 || minHoldoutRecall > 1 ||
      !Number.isFinite(maxP95Ms) || maxP95Ms <= 0) errors.push('invalid release thresholds');
  if (!report?.measured || !report?.ok || !report.summary?.holdout?.cases) errors.push('no verified holdout measurements');
  const holdout = report?.summary?.holdout;
  if (!Number.isFinite(holdout?.passRate) || holdout.passRate < minHoldoutPassRate) errors.push('holdout passRate below gate');
  if (!Number.isFinite(holdout?.recallAtK) || holdout.recallAtK < minHoldoutRecall) errors.push('holdout recall unavailable/below gate');
  if (!holdout?.byKind?.rag?.cases) errors.push('RAG holdout cases required');
  if (!holdout?.byKind?.agent?.cases) errors.push('Agent holdout cases required');
  if (!Number.isFinite(holdout?.byKind?.agent?.passRate) ||
      holdout.byKind.agent.passRate < minAgentPassRate) errors.push('agent holdout passRate below gate');
  if (holdout?.aclViolations !== 0) errors.push('ACL leakage is release-blocking');
  if (!Number.isFinite(holdout?.p95Ms) || holdout.p95Ms > maxP95Ms) errors.push('holdout p95 unavailable/above gate');
  return {approved: errors.length === 0, errors};
}
