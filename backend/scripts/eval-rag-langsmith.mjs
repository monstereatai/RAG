import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPath =
  process.env.EVAL_RAG_DATASET ??
  join(__dirname, '..', 'eval', 'rag-smoke.dataset.json');
const outputPath =
  process.env.LANGSMITH_EXPORT_PATH ??
  join(__dirname, '..', '..', '.tmp', 'langsmith-rag-eval.json');
const project = process.env.LANGSMITH_PROJECT ?? 'rag-evaluation';
const dataset = process.env.LANGSMITH_DATASET ?? 'rag-smoke';
const endpoint = (
  process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com'
).replace(/\/$/, '');
const experiment =
  process.env.LANGSMITH_EXPERIMENT ??
  `rag-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const tracing = process.env.LANGSMITH_TRACING === 'true';
const uploadEnabled = process.env.LANGSMITH_UPLOAD === 'true';
const uploadRequired = process.env.LANGSMITH_UPLOAD_REQUIRED === 'true';
const hasApiKey = Boolean(process.env.LANGSMITH_API_KEY);

const child = spawnSync(process.execPath, ['scripts/eval-rag.mjs'], {
  cwd: join(__dirname, '..'),
  env: process.env,
  encoding: 'utf8',
});

const stdout = child.stdout.trim();
const stderr = child.stderr.trim();
let evalResult;
try {
  evalResult = JSON.parse(stdout);
} catch {
  throw new Error(`eval:rag did not return JSON. stderr=${stderr}`);
}

const sourceDataset = await readSourceDataset(datasetPath);
const sourceById = new Map(sourceDataset.map((item) => [item.id, item]));

const exported = {
  schema: 'rag.langsmith.eval.v1',
  project,
  dataset,
  experiment,
  tracingEnabled: tracing,
  langsmithConfigured: tracing && hasApiKey,
  uploadEnabled,
  uploadRequired,
  generatedAt: new Date().toISOString(),
  summary: {
    passed: evalResult.passed,
    mode: evalResult.mode,
    averageScore: evalResult.averageScore,
    minAverageScore: evalResult.minAverageScore,
    totalSamples: Array.isArray(evalResult.results)
      ? evalResult.results.length
      : 0,
  },
  examples: (evalResult.results ?? []).map((item) => ({
    id: item.id,
    inputs: {
      query: sourceById.get(item.id)?.query,
      category: item.category,
      department: item.department,
      documentType: item.documentType,
    },
    referenceOutputs: {
      answer: sourceById.get(item.id)?.referenceAnswer,
      expectedKeywords: sourceById.get(item.id)?.expectedKeywords ?? [],
      expectedClaims: sourceById.get(item.id)?.expectedClaims ?? [],
      requireCitation: sourceById.get(item.id)?.requireCitation ?? false,
      expectRefusal: sourceById.get(item.id)?.expectRefusal ?? false,
      expectConflictHandling:
        sourceById.get(item.id)?.expectConflictHandling ?? false,
    },
    outputs: {
      score: item.score,
      passed: item.passed,
      keywordPassed: item.keywordPassed,
      citationPassed: item.citationPassed,
      claimsPassed: item.claimsPassed,
      refusalPassed: item.refusalPassed,
      conflictPassed: item.conflictPassed,
    },
    feedback: {
      key: 'rag_quality',
      score: item.passed ? 1 : 0,
      comment: JSON.stringify({
        claimResults: item.claimResults,
        threshold: item.threshold,
      }),
    },
  })),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');

const uploadResult = await uploadExperiment(exported);

console.log(
  JSON.stringify(
    {
      passed: evalResult.passed,
      langsmithConfigured: exported.langsmithConfigured,
      uploadEnabled,
      uploaded: uploadResult.uploaded,
      uploadRequired,
      uploadUrl: uploadResult.url,
      uploadError: uploadResult.error,
      project,
      dataset,
      experiment,
      outputPath,
      note: buildNote(uploadResult),
    },
    null,
    2,
  ),
);

if (
  child.status !== 0 ||
  evalResult.passed !== true ||
  (uploadRequired && uploadResult.uploaded !== true)
) {
  process.exitCode = 1;
}

async function readSourceDataset(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function uploadExperiment(payload) {
  if (!uploadEnabled) {
    return { uploaded: false };
  }

  if (!hasApiKey) {
    return {
      uploaded: false,
      error: 'LANGSMITH_UPLOAD=true requires LANGSMITH_API_KEY.',
    };
  }

  const body = {
    dataset_name: payload.dataset,
    experiment_name: payload.experiment,
    description: 'RAG smoke evaluation exported from backend eval:rag.',
    inputs: payload.examples.map((example) => example.inputs),
    outputs: payload.examples.map((example) => example.outputs),
    reference_outputs: payload.examples.map(
      (example) => example.referenceOutputs,
    ),
    metadata: {
      schema: payload.schema,
      project: payload.project,
      generatedAt: payload.generatedAt,
      summary: payload.summary,
      source: 'backend/scripts/eval-rag-langsmith.mjs',
    },
  };

  try {
    const res = await fetch(`${endpoint}/datasets/upload-experiment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.LANGSMITH_API_KEY,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();

    if (!res.ok) {
      return {
        uploaded: false,
        error: `LangSmith upload failed: ${res.status} ${text.slice(0, 500)}`,
      };
    }

    return {
      uploaded: true,
      url: `${endpoint}/datasets`,
      response: safeJson(text),
    };
  } catch (error) {
    return {
      uploaded: false,
      error:
        error instanceof Error ? error.message : 'Unknown LangSmith upload error',
    };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildNote(uploadResult) {
  if (uploadResult.uploaded) {
    return 'LangSmith upload finished; offline export was also generated.';
  }
  if (uploadEnabled) {
    return uploadRequired
      ? 'LangSmith upload was required but did not finish; see uploadError.'
      : 'LangSmith upload did not finish; offline export was still generated.';
  }
  if (tracing && hasApiKey) {
    return 'LangChain/DeepAgents calls can be traced by LangSmith when this script runs with LANGSMITH_TRACING=true.';
  }
  return 'Set LANGSMITH_UPLOAD=true and LANGSMITH_API_KEY to upload Dataset/Experiment; offline export was still generated.';
}
