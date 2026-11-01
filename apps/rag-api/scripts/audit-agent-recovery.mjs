/** Read-only PostgreSQL/Redis/BullMQ recovery audit. Does not mutate state or replay tools. */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { assessRun } from './lib/recovery-audit-policy.mjs';

const arg = (name) => { const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1] ?? null; };
const strict = process.argv.includes('--strict');
const pgUrl = process.env.POSTGRES_URL;
const redisUrl = process.env.REDIS_URL;
if (!pgUrl || !redisUrl) { console.error('POSTGRES_URL and REDIS_URL required (no offline success fallback)'); process.exit(2); }

let pgClient, redis, queue;
const safe = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0,12);
try {
  const [{Client}, {default:Redis}, {Queue}] = await Promise.all([import('pg'),import('ioredis'),import('bullmq')]);
  pgClient = new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,query_timeout:15000});
  redis = new Redis(redisUrl,{connectTimeout:5000,maxRetriesPerRequest:1,retryStrategy:()=>null, lazyConnect:true});
  redis.on('error',()=>{});
  await Promise.all([pgClient.connect(),redis.connect()]);
  await redis.ping();
  const nowMs=Date.now(), staleMs=Number(process.env.AGENT_RECOVERY_STALE_MS ?? 30*60*1000);
  if (!Number.isFinite(staleMs) || staleMs < 60_000) throw new Error('invalid AGENT_RECOVERY_STALE_MS');
  const {rows}=await pgClient.query(`SELECT id, "threadId", mode, status, "updatedAt", "cancelSignalPending"
    FROM agent_runs WHERE status IN ('running','waiting_approval') OR "cancelSignalPending" = TRUE
    ORDER BY "updatedAt" ASC LIMIT 500`);
  const findings=[];
  for (const run of rows) {
    // A checkpoint is mandatory only for explicit agentic human approval.
    const needsCheckpoint=run.mode==='agentic' && run.status==='waiting_approval';
    const [checkpointId, cancelSignal]=await Promise.all([
      needsCheckpoint ? redis.get(`checkpoint:latest:${run.threadId}`) : Promise.resolve(null),
      run.cancelSignalPending ? redis.get(`agent-loop:cancel:${run.threadId}:${run.id}`) : Promise.resolve(null),
    ]);
    const issues=assessRun(run,{nowMs,staleMs,hasCheckpoint:needsCheckpoint ? Boolean(checkpointId) : null,cancelSignalPresent:cancelSignal==='cancelled'});
    for (const issue of issues) findings.push({runRef:safe(run.id),threadRef:safe(run.threadId),...issue});
  }
  queue=new Queue('production-workflow',{connection:{url:redisUrl}});
  const counts=await queue.getJobCounts('waiting','active','delayed','failed','completed');
  const failedJobs=await queue.getFailed(0,19);
  const report={kind:'agent-state-cross-store-audit',mode:'read-only',generatedAt:new Date().toISOString(),
    postgres:{checkedRuns:rows.length,limited:rows.length===500},redis:{reachable:true},
    bullmq:{counts,failedSamples:failedJobs.map(job=>({jobRef:safe(job.id ?? ''),attemptsMade:job.attemptsMade}))},
    findings,critical:findings.filter(f=>f.severity==='critical').length,
    warnings:findings.filter(f=>f.severity==='warning').length,
    constraints:['No side-effect replay. Run-to-BullMQ correlation is NOT assumed without a durable job mapping.',
      'The PG query is bounded to 500 active/pending runs and cannot prove complete historical consistency.',
      'Checkpoint existence is not proof of tool idempotency or approval state correctness.']};
  const dest=arg('--out');if(dest){await mkdir(dirname(resolve(dest)),{recursive:true});await writeFile(resolve(dest),JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
  if (strict && (report.critical>0 || report.postgres.limited || counts.failed>0)) process.exitCode=1;
} catch(error) { console.error(`Recovery audit unavailable: ${error instanceof Error ? error.message:String(error)}`); process.exitCode=2; }
finally { try { await queue?.close(); } catch {} try { await redis?.quit(); } catch { redis?.disconnect(); } try { await pgClient?.end(); } catch {} }
