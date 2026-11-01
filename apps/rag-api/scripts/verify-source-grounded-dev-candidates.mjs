#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const readJson = async (path) => JSON.parse(await readFile(path,'utf8'));
const datasetPath = process.argv[2] ?? '.tmp/private-golden/source_grounded_31_dev_candidates.json';
const dataset=await readJson(datasetPath);
assert.equal(dataset.synthetic,true,'Never use this data for production Golden release');
assert.equal(dataset.releaseApproved,false);
assert.equal(dataset.summary.cases,31);
assert.equal(dataset.summary.agentCases,0);
assert.equal(dataset.summary.holdoutCases,0);
const ids = new Set();
const sourceById = new Map(dataset.sourceIndex.map((s) => [s.docId,s]));
for (const test of dataset.cases) {
  assert(!ids.has(test.id),`Duplicate test: ${test.id}`);ids.add(test.id);
  assert.equal(test.eligibility,'UNREVIEWED_DEVELOPMENT_ONLY');
  assert.equal(test.humanReview,null);
  assert.equal(test.result,null);
  for (const id of test.expectedDocIdsForReview??[]) assert(sourceById.has(id));
  for (const id of test.draftDocumentIds??[]) {
    const source=sourceById.get(id);
    assert(source && source.lifecycleStatus==='draft');
    assert(test.forbiddenDocumentIdsInReleasedAnswer.includes(id));
  }
  for (const g of test.sourceEvidenceGroups??[]) {
    for (const item of g.alternatives) assert(sourceById.get(item.docId)?.chunkIds.includes(item.chunkId));
  }
}
const snapshotFailures=[];
const path = await import('node:path');
const url=await import('node:url');
const base = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)),'../');
for(const src of dataset.sourceIndex){
 const snapshot = await readFile(path.join(base,src.derivedSnapshot));
 const digest = createHash('sha256').update(snapshot).digest('hex');
 if (digest !== src.derivedSnapshotSha256) snapshotFailures.push(src.docId);
}
assert.deepEqual(snapshotFailures,[],'Derived source snapshots were modified');
console.log(JSON.stringify({passed:true,consistentReferences:true,sourceSnapshotsIntact:true,
 cases:ids.size,sourceDocuments:sourceById.size,synthetic:true,
 realRunValidated:false,humanReviewed:false,productionGolden:false},null,2));
