/**
 * Promotes human-annotated, source-backed candidate Golden cases to a real,
 * reviewed dataset. Deliberately fails closed: no human approval is generated.
 * Run from apps/rag-api. Source snapshots must live in .tmp/private-golden/sources.
 */
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { validateGoldenDataset } from './lib/verified-golden.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}
const candidatePath = argument('--candidate', 'eval/private-reviewed-golden.candidate.json');
const annotationsPath = argument('--evidence', '.tmp/private-golden/annotations.json');
const outputPath = argument('--out', '.tmp/private-golden/private-reviewed-golden.json');
const sourceDirectory = resolve('.tmp/private-golden/sources');
const safeId = (x) => typeof x === 'string' && x.trim().length > 0 && x.trim() === x;
const validTime = (x) => typeof x === 'string' && Number.isFinite(Date.parse(x));
const ids = (x) => Array.isArray(x) && x.every(safeId) && new Set(x).size === x.length;
const sha = (data) => createHash('sha256').update(data).digest('hex');
const errors = [];
const fail = (id, msg) => errors.push(`${id}: ${msg}`);

const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
const evidence = JSON.parse(await readFile(annotationsPath, 'utf8'));
const provenance = evidence.provenance ?? {};
if (candidate.synthetic !== true || candidate.provenance?.kind !== 'unreviewed_scenario_template') {
  fail('dataset', 'the input must be the unreviewed candidate, not a claimed real dataset');
}
if (provenance.kind !== 'sanitized_real_business' ||
    provenance.confirmedRealAndSanitized !== true ||
    !safeId(provenance.attestedBy) || !validTime(provenance.attestedAt)) {
  fail('provenance', 'real, sanitized, independently attested source provenance required');
}
const cases = [];
const realSourceDirectory = await realpath(sourceDirectory).catch(() => null);
if (!realSourceDirectory) fail('snapshots', 'create .tmp/private-golden/sources and place actual sanitized snapshot files inside it');
for (const item of candidate.cases ?? []) {
  const id = item.id;
  const e = evidence.cases?.[id];
  if (!e || typeof e !== 'object') {
    fail(id, 'annotation entry missing');
    continue;
  }
  const sourceReviewer = e.sourceReviewer ?? {};
  const sourceFiles = e.sourceFiles;
  const stableUri = e.sourceUri;
  if (!safeId(stableUri) || /example|placeholder|replace-me/i.test(stableUri)) {
    fail(id, 'real stable sourceUri required');
  }
  if (!safeId(e.sourceRevision)) fail(id, 'sourceRevision required');
  if (!sourceReviewer.approved || !safeId(sourceReviewer.reviewerId) ||
      !validTime(sourceReviewer.reviewedAt)) fail(id, 'independent source review is required');
  if (sourceReviewer.reviewerId === provenance.attestedBy && safeId(sourceReviewer.reviewerId)) {
    fail(id, 'source reviewer and real-data attestor must be different people');
  }
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    fail(id, 'at least one real source snapshot file required');
  }
  const snapshots = [];
  for (const name of (Array.isArray(sourceFiles) ? sourceFiles : [])) {
    if (!safeId(name) || isAbsolute(name)) { fail(id, 'sourceFiles must be relative paths'); continue; }
    const path = resolve(sourceDirectory, name);
    const actual = await realpath(path).catch(() => null);
    if (!actual || !realSourceDirectory ||
        !(actual.startsWith(realSourceDirectory + sep))) {
      fail(id, `source snapshot unavailable or escapes private directory: ${name}`);
      continue;
    }
    const bytes = await readFile(actual);
    if (!bytes.length || bytes.length > 2_000_000) {
      fail(id, `source snapshot must be nonempty and <=2MB: ${name}`);
      continue;
    }
    snapshots.push({ filename: name, sha256: sha(bytes) });
  }
  const expectedDocIds = e.expectedDocIds;
  const expectedChunkIds = e.expectedChunkIds;
  const forbiddenDocIds = e.forbiddenDocIds;
  const expectedClaims = e.expectedClaims;
  const expectedVersions = e.expectedVersions;
  const expectedEvents = e.expectedEvents;
  const forbiddenEvents = e.forbiddenEvents;
  for (const [label, value] of Object.entries({expectedDocIds, forbiddenDocIds})) {
    if (!ids(value)) fail(id, `${label} must be a unique list of actual IDs`);
  }
  if (item.kind === 'rag') {
    if (!ids(expectedChunkIds)) fail(id, 'expectedChunkIds must be actual unique chunk IDs');
    if (!Array.isArray(expectedClaims) || !expectedClaims.every(safeId)) fail(id, 'expectedClaims must be human-reviewed text claims');
    if (!item.expectRefusal && (!expectedDocIds?.length || !expectedChunkIds?.length || !expectedClaims?.length)) {
      fail(id, 'answerable RAG needs actual document/chunk IDs and reviewed expected claims');
    }
    if (item.scenario === 'cross_document' && (expectedDocIds?.length ?? 0) < 2) {
      fail(id, 'cross-document scenario requires at least two real document IDs');
    }
  }
  if (item.scenario === 'acl' && !(forbiddenDocIds?.length > 0)) fail(id, 'ACL case requires forbidden document IDs');
  if (item.scenario === 'version' && (!expectedVersions || Object.keys(expectedVersions).length === 0)) {
    fail(id, 'version case requires reviewed docId:version mapping');
  }
  if (item.kind === 'agent' && (!ids(expectedEvents) || !expectedEvents.length || !ids(forbiddenEvents))) {
    fail(id, 'Agent case requires real expectedEvents and forbiddenEvents list');
  }
  if (item.expectRefusal && expectedDocIds?.length) fail(id, 'refusal case cannot declare expectedDocIds');
  if (expectedDocIds?.some((x) => forbiddenDocIds?.includes(x))) fail(id, 'forbidden and expected documents overlap');
  if (!snapshots.length) fail(id, 'source SHA-256 could not be calculated');
  // For multiple documents, hash a canonical manifest of each real snapshot digest.
  const sourceHash = snapshots.length === 1 ? snapshots[0].sha256 : sha(JSON.stringify(snapshots));
  cases.push({
    id:item.id,kind:item.kind,split:item.split,scenario:item.scenario,question:e.question || item.question,
    sourceUri:stableUri,sourceHash,expectedDocIds:expectedDocIds ?? [],
    forbiddenDocIds:forbiddenDocIds ?? [],expectRefusal:item.expectRefusal === true,
    ...(item.kind === 'rag' ? {expectedChunkIds:expectedChunkIds ?? [],expectedClaims:expectedClaims ?? []} :
      {expectedEvents:expectedEvents ?? [],forbiddenEvents:forbiddenEvents ?? []}),
    ...(item.scenario === 'version' ? {expectedVersions:expectedVersions ?? {}} : {}),
    review:{approved:sourceReviewer.approved === true,reviewerId:sourceReviewer.reviewerId ?? '',
      reviewedAt:sourceReviewer.reviewedAt ?? '',sourceRevision:e.sourceRevision ?? ''}
  });
}
const output = {
  datasetId:candidate.datasetId.replace(/-candidate$/, '-real-reviewed'),
  version:argument('--version', `reviewed-${new Date().toISOString().slice(0,10)}`),
  synthetic:false,
  provenance:{kind:'sanitized_real_business',confirmedRealAndSanitized:true,
    attestedBy:provenance.attestedBy,attestedAt:provenance.attestedAt},
  cases
};
if (cases.length !== 100) fail('dataset', `expected 100 cases, found ${cases.length}`);
const holdout = cases.filter((c) => c.split === 'holdout');
if (!holdout.some((c) => c.kind === 'rag') || !holdout.some((c) => c.kind === 'agent')) {
  fail('dataset','Holdout must include both RAG and Agent');
}
errors.push(...validateGoldenDataset(output,{production:true,minCases:100,minHoldout:20}));
if (errors.length) {
  console.error(JSON.stringify({ready:false,errorCount:errors.length,errors:errors.slice(0,30),
    message:'Only first 30 errors shown. No production dataset was written.'},null,2));
  process.exitCode=1;
} else {
  await mkdir(dirname(resolve(outputPath)),{recursive:true});
  await writeFile(outputPath,JSON.stringify(output,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({ready:true,out:outputPath,cases:cases.length,holdout:holdout.length,
    sourceDigestsVerified:true,sourceReviewDeclarationsChecked:true,
    stillRequires:'real API capture, independent post-run human review and release gate'},null,2));
}
