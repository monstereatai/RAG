/**
 * Real, cost-bearing staging API workflow benchmark. NEVER auto-runs in CI.
 * Requires explicit staging AND LLM-cost acknowledgements. Run on dedicated
 * staging with multiple configured Worker instances. Does not fake Worker IDs.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { opt, report, sleep, percentile } from './lib/platform-validation-utils.mjs';

const total=Number(opt('--total','30'));
const concurrency=Number(opt('--concurrency','3'));
const maxWait=Number(opt('--timeout-ms','600000'));
const output=opt('--out','.tmp/evidence/platform-real-workflow-cluster.json');
const api=(opt('--base-url',process.env.RAG_API_BASE_URL)||'http://127.0.0.1:3000/api/v1').replace(/\/$/,'');
const token=process.env.RAG_EVAL_ACCESS_TOKEN;
if(!Number.isInteger(total)||total<5||total>50||!Number.isInteger(concurrency)||concurrency<1||concurrency>8||
   !Number.isInteger(maxWait)||maxWait<10_000||maxWait>1_800_000) throw new Error('Invalid --total 5..50, --concurrency 1..8, --timeout-ms 10000..1800000');
if(process.env.PLATFORM_VALIDATION_STAGING_CONFIRMED!=='I_ACKNOWLEDGE_ISOLATED_STAGING' ||
   process.env.PLATFORM_VALIDATION_ALLOW_LLM_COST!=='I_ACKNOWLEDGE_TEST_COST')
  throw new Error('Real workflows require explicit isolated-staging AND LLM-cost approvals');
if(!token) throw new Error('RAG_EVAL_ACCESS_TOKEN required; do not use a production admin token');
if(!api.startsWith('http://127.0.0.1:')&&!api.startsWith('http://localhost:')&&!api.startsWith('https://'))
  throw new Error('Use local staging API or an authenticated HTTPS staging tunnel');
const unwrap=(o)=>o?.data??o;
async function request(path,method='GET',body){
  const response=await fetch(`${api}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120_000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${path}`);
  return unwrap(await response.json());
}
async function single(i){
  const id=randomUUID();
  const start=performance.now();
  try{
    const started=await request('/workflows/production','POST',{
      threadId:id,projectId:`platform-validation-${id}`,roles:['product'],approvalMode:'auto',
      brief:'隔离测试：为游戏活动编写产品需求审查清单，检查页面、接口、异常、性能与测试验收，不得调用任何真实发布或外部发奖服务。',
    });
    const threadId=started.threadId;
    if(threadId!==id)throw new Error('Unexpected workflow threadId');
    let state=started;
    const deadline=Date.now()+maxWait;
    while(state.status==='running'&&Date.now()<deadline){await sleep(1500);state=await request(`/workflows/production/${encodeURIComponent(threadId)}`);}
    return {index:i,threadId,status:state.status,durationMs:Math.round(performance.now()-start),completed:state.status==='completed',
      error:state.status==='completed'?null:String(state.error??'workflow incomplete').slice(0,180)};
  }catch(error){return{index:i,threadId:id,status:'failed',durationMs:Math.round(performance.now()-start),completed:false,error:(error instanceof Error?error.message:String(error)).slice(0,180)};}
}
let result;
try {
  const queue=await request('/workflows/production/queue/status');
  if(!queue.enabled)throw new Error('Workflow BullMQ queue is not enabled');
  const started=Date.now();
  let index=0;
  const cases=[];
  async function task(){while(index<total){const n=index++;cases.push(await single(n));}}
  await Promise.all(Array.from({length:Math.min(concurrency,total)},()=>task()));
  cases.sort((a,b)=>a.index-b.index);
  const finished=cases.filter(c=>c.completed);
  const threadIds=new Set(cases.map(c=>c.threadId));
  const passed=finished.length===total&&threadIds.size===total;
  result={kind:'real-staging-workflow-benchmark',passed,evidenceLevel:'real_staging_api',
    baseUrl:api,attempted:total,completed:finished.length,failed:total-finished.length,
    requestConcurrency:concurrency,queueEnabled:queue.enabled,
    p50Ms:percentile(cases.map(c=>c.durationMs),.50),p95Ms:percentile(cases.map(c=>c.durationMs),.95),
    throughputPerSecond:Number((finished.length*1000/Math.max(1,Date.now()-started)).toFixed(3)),
    workerDistributionVerified:false,
    limitations:['Does NOT prove work was distributed to multiple machines: correlate WORKFLOW_WORKER_ID worker logs separately',
      'Staging workflows can incur real LLM/API cost; isolate tool credentials and quotas',
      'Does not automatically inject worker failure or inspect PostgreSQL reconciliation'],
    cases};
} catch(error){result={kind:'real-staging-workflow-benchmark',passed:false,reason:error instanceof Error?error.message:String(error)};}
const saved=await report(output,result);
console.log(JSON.stringify({saved,passed:result.passed,attempted:result.attempted,completed:result.completed,
  p95Ms:result.p95Ms,reason:result.reason,workerDistributionVerified:false},null,2));
if(!result.passed)process.exitCode=1;
