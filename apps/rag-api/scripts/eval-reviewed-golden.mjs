import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { validateGoldenDataset, scoreGoldenDataset, applyReleaseGate } from './lib/verified-golden.mjs';

function opt(name) { const p=process.argv.indexOf(name);return p<0?null:process.argv[p+1] ?? null; }
const strict = process.argv.includes('--release');
const datasetPath = opt('--dataset') ?? process.env.REVIEWED_GOLDEN_DATASET;
const observationPath = opt('--observations') ?? process.env.REVIEWED_GOLDEN_OBSERVATIONS;
if (!datasetPath) { console.error('Use --dataset PATH [--observations PATH] [--release] [--out PATH]'); process.exit(2); }
try {
  const dataset = JSON.parse(await readFile(resolve(datasetPath),'utf8'));
  const production = strict;
  const minHoldout = strict ? Number(process.env.REVIEWED_GOLDEN_MIN_HOLDOUT ?? '20') : 1;
  const minCases = strict ? Number(process.env.REVIEWED_GOLDEN_MIN_CASES ?? '50') : 1;
  const report = observationPath
    ? scoreGoldenDataset(dataset, JSON.parse(await readFile(resolve(observationPath),'utf8')), {production, minHoldout, minCases})
    : {ok:false, measured:false, errors:validateGoldenDataset(dataset,{production,minHoldout,minCases}), results:[], summary:null};
  if (!observationPath && report.errors.length===0) { report.ok = !strict; report.contractValid = true; report.reason = 'only contract validated; no live run measured'; }
  const gate = strict ? applyReleaseGate(report, {
    minHoldoutPassRate: Number(process.env.REVIEWED_GOLDEN_MIN_PASS_RATE ?? '0.9'),
    minHoldoutRecall: Number(process.env.REVIEWED_GOLDEN_MIN_RECALL ?? '0.8'),
    minAgentPassRate: Number(process.env.REVIEWED_GOLDEN_MIN_AGENT_PASS_RATE ?? '0.95'),
    maxP95Ms: Number(process.env.REVIEWED_GOLDEN_MAX_P95_MS ?? '30000'),
  }): {approved:false, errors:['not a release run']};
  const output = {kind:'reviewed-golden', releaseRequested:strict, ...report, gate};
  const path = opt('--out');
  if (path) { await mkdir(dirname(resolve(path)),{recursive:true}); await writeFile(resolve(path),JSON.stringify(output,null,2)+'\n'); }
  console.log(JSON.stringify(output,null,2));
  if (strict ? !gate.approved : !report.ok) process.exitCode = 1;
} catch(e) { console.error(`Reviewed golden failed: ${e instanceof Error?e.message:String(e)}`); process.exitCode=2; }
