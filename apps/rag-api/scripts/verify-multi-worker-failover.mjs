/** Multi-process BullMQ load + SIGKILL after committed idempotent effect. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Queue, QueueEvents } from 'bullmq';
import { disposableRedis, awaitRedis, id, opt, report, sleep, percentile } from './lib/platform-validation-utils.mjs';

const tasks = Number(opt('--jobs', '100'));
const instances = Number(opt('--workers', '3'));
const concurrency = Number(opt('--concurrency', '4'));
const target = opt('--out', '.tmp/evidence/platform-multi-worker.json');
if (!Number.isInteger(tasks) || tasks < 30 || tasks > 2000 ||
    !Number.isInteger(instances) || instances < 2 || instances > 8 ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
  throw new Error('Use --jobs 30..2000 --workers 2..8 --concurrency 1..16');
}
const children=[];
function workerProcess(url, queue, prefix, role, count) {
  const child = spawn(process.execPath, ['scripts/platform-validation-worker.mjs', url, queue, prefix, role, String(count)], {
    cwd: process.cwd(), stdio: ['ignore','pipe','pipe'],
  });
  const messages=[];
  let stderr='';
  child.on('error', (error) => { stderr=(stderr+`spawn error: ${error.message}`).slice(-2000); });
  child.stderr.on('data', (chunk)=> { stderr=(stderr+chunk.toString()).slice(-2000); });
  child.stdout.setEncoding('utf8');
  let buffer='';
  child.stdout.on('data', (chunk) => {
    buffer+=chunk;
    const parts=buffer.split('\n');buffer=parts.pop()??'';
    for(const part of parts) try { messages.push(JSON.parse(part)); } catch {}
  });
  // Cleanup operates on the same wrapper returned to the caller, not a raw ChildProcess.
  const processRecord = {child,messages,get stderr(){return stderr}};
  children.push(processRecord);
  return processRecord;
}
async function waitFor(process, predicate, label, timeoutMs=12_000) {
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){
    if(process.messages.some(predicate)) return;
    if(process.child.exitCode !== null || process.child.signalCode !== null)
      throw new Error(`${label} exited early: ${process.stderr}`);
    await sleep(25);
  }
  throw new Error(`${label} timed out: ${process.stderr}`);
}
let output;
try {
  output = await disposableRedis(async ({url}) => {
    const redis = await awaitRedis(url);
    const runId=id();
    const name=`rag-validation-${runId}`;
    const prefix=`rag-validation:${runId}`;
    const queue=new Queue(name,{connection:{url},defaultJobOptions:{attempts:3,removeOnComplete:false,removeOnFail:false}});
    const events=new QueueEvents(name,{connection:{url}});
    try {
      await events.waitUntilReady();
      let stalled=0;
      events.on('stalled',()=>{stalled+=1;});
      const victim=workerProcess(url,name,prefix,'victim',1);
      await waitFor(victim, x=>x.type==='ready','victim worker');
      const chaosId='stalled-before-ack';
      await queue.add('validation',{chaos:true,sleepMs:5},{jobId:chaosId});
      await waitFor(victim,x=>x.type==='effect_committed_before_ack'&&x.jobId===chaosId,'pre-ack fault');
      victim.child.kill('SIGKILL');
      const running=[];
      for(let i=0;i<instances;i++) running.push(workerProcess(url,name,prefix,`worker-${i+1}`,concurrency));
      await Promise.all(running.map((w,i)=>waitFor(w,x=>x.type==='ready',`worker-${i+1}`)));
      const started=Date.now();
      const bulk=Array.from({length:tasks},(_,i)=>({name:'validation',data:{sleepMs:35},opts:{jobId:`job-${i}`}}));
      await queue.addBulk(bulk);
      // Duplicate submissions of known IDs must NOT duplicate effects.
      for(let i=0;i<Math.min(tasks,30);i++) await queue.add('validation',{sleepMs:35},{jobId:`job-${i}`});
      const until=Date.now()+120_000;
      while(Date.now()<until){
        const counts=await queue.getJobCounts('completed','failed','waiting','active','delayed');
        if(counts.failed>0) throw new Error(`BullMQ failed jobs: ${counts.failed}`);
        if(counts.completed===tasks+1 && counts.active===0) break;
        await sleep(200);
      }
      const counts=await queue.getJobCounts('completed','failed','waiting','active','delayed');
      assert.equal(counts.completed,tasks+1,'Not all jobs were recovered/completed');
      assert.equal(counts.failed,0);
      const effects=Number(await redis.get(`${prefix}:effects`));
      assert.equal(effects,tasks+1,'Side effects ran more than once or were lost');
      const usedWorkers=await redis.smembers(`${prefix}:workers`);
      const processingCount=[victim,...running].reduce((n,w)=>n+w.messages.filter(x=>x.type==='processed'&&x.jobId===chaosId).length,0);
      assert.ok(processingCount>=2,'Stalled job was not processed again after SIGKILL');
      assert.ok(usedWorkers.filter(x=>x!=='victim').length>=2,'Did not demonstrate multi-instance consumption');
      const jobs=await Promise.all([chaosId,...bulk.map(x=>x.opts.jobId)].map(jobId=>queue.getJob(jobId)));
      const durations=jobs.filter(Boolean).map(job=>job.finishedOn-job.timestamp).filter(x=>Number.isFinite(x)&&x>=0);
      const elapsedMs=Math.max(1,Date.now()-started);
      return {passed:true,evidenceLevel:'real_local_docker',isolation:'new-container/new-queue',
        jobs:tasks+1,duplicateSubmissions:Math.min(tasks,30),workerInstances:instances,
        concurrencyPerWorker:concurrency,workerNames:usedWorkers.sort(),
        victimKilledAfterEffect:true,stalledObserved:stalled,chaosJobProcessedCount:processingCount,
        completed:counts.completed,failed:counts.failed,uniqueEffects:effects,
        throughputPerSecond:Number(((tasks+1)*1000/elapsedMs).toFixed(2)),
        p50Ms:percentile(durations,0.50),p95Ms:percentile(durations,0.95),p99Ms:percentile(durations,0.99),
        limits:['Side-effect test uses a Redis-backed simulated idempotent tool, not third-party production APIs',
          'Worker processes share one Redis; no PostgreSQL or external API failure tested']};
    } finally {
      for(const proc of children) if(proc.child.exitCode===null) proc.child.kill('SIGTERM');
      await sleep(150);
      await events.close().catch(()=>{});
      await queue.obliterate({force:true}).catch(()=>{});
      await queue.close().catch(()=>{});
      redis.disconnect();
    }
  });
} catch(error){output={passed:false,evidenceLevel:'real_local_docker',reason:error instanceof Error?error.message:String(error)};}
finally {for(const proc of children) if(proc.child.exitCode===null) proc.child.kill('SIGKILL');}
await report(target,{kind:'multi-process-bullmq-chaos-load',...output});
console.log(JSON.stringify(output,null,2));
if(!output.passed) process.exitCode=1;
