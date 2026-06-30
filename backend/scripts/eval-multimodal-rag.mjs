import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const datasetPath =
  process.env.MULTIMODAL_EVAL_DATASET ??
  'eval/multimodal-regression.dataset.json';
const requireRealAssets = process.env.MULTIMODAL_EVAL_REQUIRE_ASSETS === 'true';

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
assertDataset(dataset);

const placeholders = dataset.documents.filter((doc) => doc.status === 'placeholder');
const missingFiles = [];
for (const doc of dataset.documents) {
  if (!doc.path) continue;
  try {
    await access(resolve(doc.path));
  } catch {
    missingFiles.push(doc.path);
  }
}

const ok = placeholders.length === 0 && missingFiles.length === 0;
const report = {
  ok: ok || !requireRealAssets,
  skipped: !ok,
  dataset: datasetPath,
  version: dataset.version,
  validatedOnly: !ok,
  documentCount: dataset.documents.length,
  queryCount: dataset.queries.length,
  modalityCoverage: summarizeModalities(dataset.documents),
  placeholders: placeholders.map((doc) => doc.id),
  missingFiles,
  nextStep: ok
    ? 'Dataset is ready for live multimodal ingestion evaluation.'
    : 'Replace placeholder records with private business PDF/audio/video/image/PPT/XLS assets and set MULTIMODAL_EVAL_REQUIRE_ASSETS=true in CI.',
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

function assertDataset(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('dataset must be an object');
  }
  if (!Array.isArray(value.documents) || value.documents.length < 3) {
    throw new Error('dataset requires at least 3 multimodal documents');
  }
  if (!Array.isArray(value.queries) || value.queries.length < 3) {
    throw new Error('dataset requires at least 3 multimodal queries');
  }
  const documentIds = new Set(value.documents.map((doc) => doc.id));
  for (const query of value.queries) {
    if (!query.id || !query.query) {
      throw new Error('each query requires id and query');
    }
    if (!Array.isArray(query.sourceDocumentIds) || query.sourceDocumentIds.length === 0) {
      throw new Error(`query ${query.id} requires sourceDocumentIds`);
    }
    for (const docId of query.sourceDocumentIds) {
      if (!documentIds.has(docId)) {
        throw new Error(`query ${query.id} references unknown document ${docId}`);
      }
    }
  }
}

function summarizeModalities(documents) {
  const summary = {};
  for (const doc of documents) {
    for (const modality of doc.expectedModalities ?? []) {
      summary[modality] = (summary[modality] ?? 0) + 1;
    }
  }
  return summary;
}
