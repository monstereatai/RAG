/** Release evidence: no auto-approval, no simulated data, no absent measurements. */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { opt, report } from './lib/platform-validation-utils.mjs';
import { scoreGoldenDataset, applyReleaseGate } from './lib/verified-golden.mjs';

const datasetPath=opt('--dataset',process.env.REVIEWED_GOLDEN_DATASET);
const observationsPath=opt('--observations',process.env.REVIEWED_GOLDEN_OBSERVATIONS);
const outputPath=opt('--out','.tmp/evidence/private-golden-release.json');
if(!datasetPath||!observationsPath)throw new Error('--dataset and --observations mandatory. No synthetic fallback.');
const dataset=JSON.parse(await readFile(datasetPath,'utf8'));
const observations=JSON.parse(await readFile(observationsPath,'utf8'));
const errors=[];
if(dataset.synthetic!==false)errors.push('synthetic Golden dataset blocked');
if(!observations?.runs||!Array.isArray(observations.runs))errors.push('actual observations missing');
if(observations.source!=='real_api')errors.push('real API observation provenance must be explicit');
const hash=createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
if(observations.datasetHash!==hash)errors.push('datasetHash differs from exact frozen human-reviewed dataset');
if(Array.isArray(observations.failures)&&observations.failures.length)errors.push('some real observations failed to capture');
if(observations.runs?.some(x=>!x.humanReview?.approved||!x.humanReview?.reviewerId||
  !x.humanReview?.reviewedAt||typeof x.humanReview.correct!=='boolean'||
  typeof x.humanReview.citationsSupported!=='boolean'))errors.push('all runs need an independent post-run human review');
if(observations.runs?.some(x=>!x.runId||x.runId==='replace-with-real-run-id'))errors.push('actual runId missing');
if(new Set((observations.runs??[]).map(x=>x.runId)).size !==(observations.runs??[]).length)errors.push('duplicate runId in observations');
if(observations.runs?.some(x=>x.humanReview?.reviewedAt&&observations.runCaptureTime&&
  Date.parse(x.humanReview.reviewedAt)<Date.parse(observations.runCaptureTime)))errors.push('review timestamp precedes actual capture');
const score=scoreGoldenDataset(dataset,observations,{production:true,minCases:100,minHoldout:20});
const gate=applyReleaseGate(score,{minHoldoutPassRate:0.90,minHoldoutRecall:0.80,maxP95Ms:30_000});
const passed=errors.length===0&&score.ok===true&&gate.approved===true;
const data={kind:'real-business-golden-evidence',passed,reviewedCases:dataset.cases?.length??0,
  observationCount:observations.runs?.length??0,errors:[...errors,...(score.errors??[]),...(gate.errors??[])],
  measured:score.measured===true,summary:score.summary,
  limitation:'Real API captures and human labels are external evidence and must be audited for validity.'};
const target=await report(outputPath,data);
console.log(JSON.stringify({savedTo:target,...data},null,2));
if(!passed)process.exitCode=1;
