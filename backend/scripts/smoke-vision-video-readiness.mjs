import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import 'dotenv/config';

const datasetPath = resolve(
  process.env.VISION_VIDEO_DATASET ?? 'eval/private-multimodal.dataset.json',
);
const requireProvider =
  process.env.VISION_VIDEO_REQUIRE_PROVIDER === 'true' ||
  process.argv.includes('--require-provider');

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const documents = Array.isArray(dataset.documents) ? dataset.documents : [];
const imageDocs = documents.filter((doc) => doc.type === 'image');
const videoDocs = documents.filter((doc) => doc.type === 'video');
const audioDocs = documents.filter((doc) => doc.type === 'audio');
const missingFiles = [];
const missingTranscripts = [];
const missingOcrSidecars = [];

for (const doc of [...imageDocs, ...videoDocs, ...audioDocs]) {
  if (!(await exists(doc.path))) missingFiles.push(doc.path);
  if (doc.type === 'image' && !(await exists(doc.ocrPath))) {
    missingOcrSidecars.push(doc.ocrPath ?? `${doc.id}: ocrPath missing`);
  }
  if ((doc.type === 'video' || doc.type === 'audio') && !(await exists(doc.transcriptPath))) {
    missingTranscripts.push(doc.transcriptPath ?? `${doc.id}: transcriptPath missing`);
  }
}

const provider = process.env.VISION_PROVIDER ?? process.env.MULTIMODAL_PROVIDER ?? '';
const providerConfigured =
  Boolean(provider) &&
  (Boolean(process.env.VISION_API_KEY) ||
    Boolean(process.env.QWEN_VL_API_KEY) ||
    Boolean(process.env.OPENAI_API_KEY));

const datasetReady =
  imageDocs.length > 0 &&
  videoDocs.length > 0 &&
  missingFiles.length === 0 &&
  missingOcrSidecars.length === 0 &&
  missingTranscripts.length === 0;
const ok = datasetReady && (providerConfigured || !requireProvider);

console.log(
  JSON.stringify(
    {
      ok,
      datasetPath,
      datasetReady,
      requireProvider,
      providerConfigured,
      provider: provider || null,
      imageDocuments: imageDocs.length,
      videoDocuments: videoDocs.length,
      audioDocuments: audioDocs.length,
      missingFiles,
      missingTranscripts,
      missingOcrSidecars,
      nextStep: providerConfigured
        ? 'Vision/video provider is configured; wire live OCR/video embedding calls into ingestion.'
        : 'Dataset and sidecar transcripts are ready. Configure VISION_PROVIDER plus VISION_API_KEY or QWEN_VL_API_KEY to run true OCR/video understanding.',
    },
    null,
    2,
  ),
);

if (!ok) process.exitCode = 1;

async function exists(path) {
  if (!path) return false;
  try {
    await access(resolve(path));
    return true;
  } catch {
    return false;
  }
}
