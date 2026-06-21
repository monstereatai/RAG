import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath =
  process.env.EVAL_RAG_JUDGE_INPUT ??
  process.env.EVAL_RAG_DATASET ??
  join(__dirname, '..', 'eval', 'rag-smoke.dataset.json');
const apiKey = process.env.QWEN_API_KEY;
const baseUrl =
  process.env.QWEN_BASE_URL ??
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
const model = process.env.EVAL_RAG_JUDGE_MODEL ?? process.env.QWEN_MODEL ?? 'qwen-plus';
const minSupportedRate = Number(
  process.env.EVAL_RAG_JUDGE_MIN_SUPPORTED_RATE ?? '0.9',
);
const maxClaims = Number(process.env.EVAL_RAG_JUDGE_MAX_CLAIMS ?? '0');

const items = normalizeInput(JSON.parse(await readFile(inputPath, 'utf8')));

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: 'QWEN_API_KEY is not set',
        inputPath,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const results = [];
for (const item of items) {
  for (const claim of item.claims) {
    if (maxClaims > 0 && results.length >= maxClaims) {
      break;
    }
    const judgement = await judgeClaim({
      id: item.id,
      answer: item.answer,
      evidence: item.evidence,
      claim,
    });
    results.push({ id: item.id, claim: claim.text, ...judgement });
  }
  if (maxClaims > 0 && results.length >= maxClaims) {
    break;
  }
}

const supported = results.filter((item) => item.label === 'supported').length;
const supportedRate =
  results.length === 0 ? 1 : Number((supported / results.length).toFixed(3));
const ok =
  results.every((item) => item.validJson) && supportedRate >= minSupportedRate;

console.log(
  JSON.stringify(
    {
      ok,
      skipped: false,
      inputPath,
      model,
      minSupportedRate,
      maxClaims,
      supportedRate,
      totalClaims: results.length,
      summary: summarize(results),
      results,
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
}

function normalizeInput(raw) {
  const rows = Array.isArray(raw.results) ? raw.results : raw;
  if (!Array.isArray(rows)) {
    throw new Error('judge input must be an array or { results: [...] }');
  }

  return rows
    .map((row) => {
      const claims = Array.isArray(row.expectedClaims)
        ? row.expectedClaims
        : Array.isArray(row.claims)
          ? row.claims
          : [];
      return {
        id: row.id,
        answer: row.answer ?? row.referenceAnswer ?? '',
        evidence: row.evidence ?? row.referenceAnswer ?? '',
        claims: claims.map((claim) =>
          typeof claim === 'string' ? { text: claim } : claim,
        ),
      };
    })
    .filter((row) => row.answer && row.evidence && row.claims.length > 0);
}

async function judgeClaim({ id, answer, evidence, claim }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是 RAG 答案事实支撑评测器。只输出 JSON，不要输出解释性正文。',
        },
        {
          role: 'user',
          content: [
            '判断 claim 是否能被 evidence 支撑。',
            'label 只能是 supported、contradicted、not_mentioned。',
            'JSON schema: {"label":"supported|contradicted|not_mentioned","confidence":0-1}',
            `case_id: ${id}`,
            `answer: ${answer}`,
            `claim: ${claim.text}`,
            `evidence: ${evidence}`,
          ].join('\n'),
        },
      ],
    }),
  });

  if (!res.ok) {
    return {
      validJson: false,
      label: 'not_mentioned',
      confidence: 0,
      error: `judge request failed: ${res.status}`,
    };
  }

  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(content);
    const label = normalizeLabel(parsed.label);
    return {
      validJson: true,
      label,
      confidence: clampConfidence(parsed.confidence),
    };
  } catch {
    return {
      validJson: false,
      label: 'not_mentioned',
      confidence: 0,
      error: 'judge returned invalid JSON',
    };
  }
}

function normalizeLabel(label) {
  const value = String(label ?? '').toLowerCase();
  if (['supported', 'contradicted', 'not_mentioned'].includes(value)) {
    return value;
  }
  return 'not_mentioned';
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(Math.max(number, 0), 1);
}

function summarize(results) {
  return results.reduce(
    (acc, item) => {
      acc[item.label] += 1;
      return acc;
    },
    { supported: 0, contradicted: 0, not_mentioned: 0 },
  );
}
