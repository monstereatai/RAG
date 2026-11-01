import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGoldenDataset, scoreGoldenDataset, applyReleaseGate} from './verified-golden.mjs';
import {assessRun} from './recovery-audit-policy.mjs';
const reviewed = {approved:true,reviewerId:'human-1',reviewedAt:'2026-10-31T12:00:00Z',sourceRevision:'version1'};
const dataset = {datasetId:'business-reviewed',version:'1',synthetic:false,cases:[
  {id:'a',kind:'rag',split:'holdout',scenario:'direct',question:'what?',sourceUri:'private://a',sourceHash:'a'.repeat(64),expectedDocIds:['doc-a'],forbiddenDocIds:['doc-secret'],expectedClaims:['answer'],expectRefusal:false,review:reviewed},
  {id:'b',kind:'agent',split:'holdout',scenario:'checkpoint_resume',question:'resume?',sourceUri:'private://b',sourceHash:'b'.repeat(64),expectedDocIds:[],forbiddenDocIds:[],expectedEvents:['start','done'],forbiddenEvents:['tool.unknown'],expectRefusal:false,review:reviewed}
]};
const observed = {runs:[
 {caseId:'a',runId:'run-a',status:'completed',durationMs:3000,retrievedDocIds:['doc-a'],citedDocIds:['doc-a'],refused:false,humanReview:{...reviewed,correct:true,citationsSupported:true}},
 {caseId:'b',runId:'run-b',status:'completed',durationMs:1000,retrievedDocIds:[],citedDocIds:[],refused:false,events:[{eventType:'start'},{eventType:'done'}],humanReview:{...reviewed,correct:true,citationsSupported:true}}
]};
test('reviewed source can be scored; ranked evidence and agent trajectory',()=>{
 assert.deepEqual(validateGoldenDataset(dataset,{minHoldout:1}),[]);
 const result=scoreGoldenDataset(dataset,observed,{k:5});
 assert.equal(result.ok,true);assert.equal(result.summary.holdout.recallAtK,1);
 assert.equal(result.summary.holdout.passRate,1);
 assert.equal(result.summary.holdout.byKind.rag.cases,1);
 assert.equal(result.summary.holdout.byKind.agent.cases,1);
 assert.equal(applyReleaseGate(result).approved,true);
});
test('release gate refuses synthetic despite plausible metrics',()=>{
 const testset={...dataset,synthetic:true};
 const result=scoreGoldenDataset(testset,observed,{production:true,minHoldout:1,minCases:1});
 assert.equal(result.ok,false);assert.equal(applyReleaseGate(result).approved,false);
});
test('unreviewed observation cannot be silently counted as success',()=>{
 const report=scoreGoldenDataset(dataset,{runs:[{...observed.runs[0],humanReview:null},observed.runs[1]]});
 assert.equal(report.measured,false);assert.match(report.errors.join(';'),/independent human observation review/);
});
test('missing, duplicate or forbidden doc evidence fails closed',()=>{
 const obs={runs:[{...observed.runs[0],retrievedDocIds:['doc-secret','doc-a'],citedDocIds:['doc-a']},observed.runs[1]]};
 const report=scoreGoldenDataset(dataset,obs);
 assert.equal(report.ok,true);assert.equal(report.results[0].passed,false);assert.equal(report.summary.holdout.aclViolations,1);
 assert.equal(applyReleaseGate(report).approved,false);
});
test('agent unexpected tool.unknown blocks trajectory',()=>{
 const obs={runs:[observed.runs[0],{...observed.runs[1],events:[{eventType:'start'},{eventType:'tool.unknown'},{eventType:'done'}]}]};
 const report=scoreGoldenDataset(dataset,obs);
 assert.equal(report.results[1].trajectoryCorrect,false);
});
test('no real observations cannot be a release',()=>{
 const report=scoreGoldenDataset(dataset,{runs:[]});
 assert.equal(report.ok,false);assert.equal(applyReleaseGate(report).approved,false);
});
test('stale run is flagged for human reconciliation, never replayed',()=>{
 const results=assessRun({status:'running',mode:'agentic',updatedAt:'2026-10-01T00:00:00Z',cancelSignalPending:false},{nowMs:Date.parse('2026-11-01T00:00:00Z'),staleMs:30*60*1000});
 assert.deepEqual(results.map(x=>x.code),['stale_run_manual_reconciliation']);
});
test('missing approval checkpoint and pending cancellation are surfaced',()=>{
 const results=assessRun({status:'waiting_approval',mode:'agentic',updatedAt:'2026-11-01T00:00:00Z',cancelSignalPending:true},{nowMs:Date.parse('2026-11-01T00:00:00Z'),staleMs:30*60*1000,hasCheckpoint:false});
 assert.deepEqual(results.map(x=>x.code),['cancel_signal_pending','approval_checkpoint_missing_manual_reconciliation']);
});
