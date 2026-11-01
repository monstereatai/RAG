/** Assemble separate *actual* evidence reports; never manufacture green status. */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { opt, report } from './lib/platform-validation-utils.mjs';

const inputs={
  redis: opt('--redis', '.tmp/evidence/platform-redis-recovery.json'),
  workers: opt('--workers', '.tmp/evidence/platform-multi-worker.json'),
  crossStore: opt('--cross-store', '.tmp/evidence/platform-cross-store-recovery.json'),
  golden: opt('--golden', '.tmp/evidence/private-golden-release.json'),
};
const expected={
  redis: x=>x.passed===true && x.evidenceLevel==='real_local_docker' && x.isolated===true &&
    x.redisStopped===true && x.unavailableWriteRejected===true &&
    x.checkpointSurvivedRestart===true && x.pendingWritesSurvivedRestart===true &&
    x.postRestartWriteWorked===true && x.cleanupWorked===true,
  workers: x=>x.passed===true && x.evidenceLevel==='real_local_docker' &&
    x.workerInstances>=2 && x.jobs>=100 && x.failed===0 && x.completed===x.jobs &&
    x.uniqueEffects===x.jobs && x.victimKilledAfterEffect===true && x.stalledObserved>=1 &&
    x.chaosJobProcessedCount>=2 && x.throughputPerSecond>0,
  crossStore: x=>x.passed===true && x.evidenceLevel==='real_local_docker' && x.isolated===true &&
    Object.values(x.checks??{}).length>=8 && Object.values(x.checks??{}).every(v=>v===true),
  golden: x=>x.passed===true && x.measured===true && x.reviewedCases>=100 && x.observationCount>=100 &&
    Array.isArray(x.errors) && x.errors.length===0 &&
    x.summary?.holdout?.byKind?.rag?.cases>0 && x.summary?.holdout?.byKind?.agent?.cases>0,
};
const checks={};
for(const [kind,path] of Object.entries(inputs)){
  try{
    const bytes=await readFile(path);
    const value=JSON.parse(bytes.toString('utf8'));
    checks[kind]={passed:expected[kind](value),path,hash:createHash('sha256').update(bytes).digest('hex'),
      recordedAt:value.generatedAt??null};
  }catch(e){checks[kind]={passed:false,path,reason:e instanceof Error?e.message:String(e)};}
}
const passed=Object.values(checks).every(c=>c.passed);
const evidence={passed,kind:'agent-platform-technical-validation-aggregate',checks,
  important:'This aggregate proves only the recorded isolated experiments and separately reviewed evaluation. It is not a production uptime guarantee or a certified 9/10 score.'};
console.log(JSON.stringify({out:await report(opt('--out','.tmp/evidence/platform-9-acceptance.json'),evidence),...evidence},null,2));
if(!passed)process.exitCode=1;
