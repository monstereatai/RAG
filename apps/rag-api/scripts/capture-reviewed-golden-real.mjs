/**
 * Capture REAL RAG API responses and EXISTING Agent run-center traces.
 * This only produces an UNREVIEWED draft. Independent human review is required.
 * Output contains private answers and source references: NEVER COMMIT TO GIT.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { opt, report } from './lib/platform-validation-utils.mjs';
import { validateGoldenDataset } from './lib/verified-golden.mjs';

const inputPath=opt('--dataset',process.env.REVIEWED_GOLDEN_DATASET);
const outputPath=opt('--out','.tmp/evidence/private-golden-observations.draft.json');
const mapPath=opt('--agent-run-map',process.env.AGENT_VALIDATION_RUN_MAP);
const base=(opt('--base-url',process.env.RAG_API_BASE_URL)||'http://127.0.0.1:3000/api/v1').replace(/\/$/,'');
const adminBase=(process.env.RAG_ADMIN_API_BASE_URL||'http://127.0.0.1:3000/api/v1').replace(/\/$/,'');
const token=process.env.RAG_EVAL_ACCESS_TOKEN;
const adminToken=process.env.RAG_ADMIN_ACCESS_TOKEN;
if(!inputPath) throw new Error('--dataset PATH required');
const dataset=JSON.parse(await readFile(inputPath,'utf8'));
const errors=validateGoldenDataset(dataset,{production:true,minCases:50,minHoldout:20});
if(errors.length) throw new Error('Real reviewed dataset invalid: '+errors.join('; '));
const map=mapPath?JSON.parse(await readFile(mapPath,'utf8')):{};
const sha256=(x)=>createHash('sha256').update(x).digest('hex');
const draft={schemaVersion:1,kind:'private-unreviewed-golden-observations',source:'real_api',
  datasetHash:sha256(JSON.stringify(dataset)),
  runCaptureTime:new Date().toISOString(),baseUrl:base,
  warnings:['All humanReview values are null until independent post-run review',
    'Do not commit this file: it contains actual answers and may expose private data',
    'Missing run events / versions / citations are NOT auto-filled'],runs:[],failures:[]};

function unwrap(x){return x?.data??x;}
async function getJson(url, key, init={}){
  const response=await fetch(url,{...init,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(init.headers??{})},signal:AbortSignal.timeout(120_000)});
  if(!response.ok) throw new Error(`${response.status} from ${new URL(url).pathname}`);
  return unwrap(await response.json());
}
function getCitationDocs(answer,references){
  const found=new Set();
  // Only references actually cited in the final answer count. Do NOT silently
  // equate retrieved documents with cited documents.
  for(const match of String(answer).matchAll(/\[片段\s*(\d+)\]/g)){
    const index=Number(match[1])-1;
    if(index>=0&&references[index]?.docId) found.add(references[index].docId);
  }
  for(const reference of references){
    if(typeof reference?.citationLabel==='string' && reference.citationLabel.trim() &&
       String(answer).includes(reference.citationLabel) && reference.docId){
      found.add(reference.docId);
    }
  }
  return [...found];
}
for(const item of dataset.cases){
  try {
    if(item.kind==='rag'){
      if(!token) throw new Error('RAG_EVAL_ACCESS_TOKEN not configured');
      const start=performance.now();
      const result=await getJson(`${base}/chat`,token,{method:'POST',body:JSON.stringify({query:item.question,mode:'auto',useLongTermMemory:false})});
      if(typeof result.runId!=='string'||!result.runId) throw new Error('API did not return actual runId');
      const refs=Array.isArray(result.references)?result.references:[];
      const docIds=[...new Set(refs.map(r=>r.docId).filter(x=>typeof x==='string'&&x))];
      const chunkIds=[...new Set(refs.map(r=>r.id).filter(x=>typeof x==='string'&&x))];
      const versions=Object.fromEntries(refs.filter(r=>typeof r.docVersion==='string'&&r.docId).map(r=>[r.docId,r.docVersion]));
      draft.runs.push({caseId:item.id,runId:result.runId,status:'completed',
        durationMs:Math.round(performance.now()-start),mode:'auto',
        retrievedDocIds:docIds,retrievedChunkIds:chunkIds,
        citedDocIds:getCitationDocs(result.answer,refs),retrievedVersions:versions,
        refused:result.retrievalSufficient===false,
        answerForHumanReview:String(result.answer??''),
        referencesForHumanReview:refs.map(r=>({id:r.id,docId:r.docId,citationLabel:r.citationLabel??null})),
        humanReview:null});
    }else {
      const runId=map[item.id];
      if(typeof runId!=='string'||!runId) throw new Error('No real Agent runId in --agent-run-map');
      if(!adminToken) throw new Error('RAG_ADMIN_ACCESS_TOKEN required to read existing Agent traces');
      const result=await getJson(`${adminBase}/rag/admin/agent-ops/run-center/${encodeURIComponent(runId)}`,adminToken);
      if(result.id!==runId) throw new Error('Admin run-center ID does not match expected runId');
      const events=Array.isArray(result.events)?result.events:[];
      if(!events.length) throw new Error('Real run has no persisted Agent events');
      const start=new Date(result.createdAt).getTime();
      const finish=new Date(result.finishedAt).getTime();
      if(!Number.isFinite(start)||!Number.isFinite(finish)||finish<start) throw new Error('Actual run start/finish timestamps unavailable');
      draft.runs.push({caseId:item.id,runId,status:result.status,
        durationMs:finish-start,retrievedDocIds:[],retrievedChunkIds:[],citedDocIds:[],retrievedVersions:{},
        refused:false,events:events.map(e=>({eventType:e.eventType,sequence:e.sequence})),
        humanReview:null,
        note:'Verify any retrieval evidence, refusal and unknown tool results against original Agent trace'});
    }
  }catch(e){draft.failures.push({caseId:item.id,kind:item.kind,reason:e instanceof Error?e.message:String(e)});}
}
draft.captured=draft.runs.length;
draft.total=dataset.cases.length;
draft.readyForReview=draft.failures.length===0&&draft.captured===draft.total;
const target=await report(outputPath,draft);
console.log(JSON.stringify({savedTo:target,realRunCount:draft.captured,total:draft.total,failures:draft.failures,
  humanReviewed:false,releaseApproved:false},null,2));
if(!draft.readyForReview)process.exitCode=1;
