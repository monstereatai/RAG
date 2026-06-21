import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input ?? process.env.BUSINESS_REGRESSION_IMPORT;
const outputPath = resolve(
  args.output ?? process.env.BUSINESS_REGRESSION_OUTPUT ?? 'eval/business-regression.dataset.json',
);
const write = args.write === true;
const minCases = Number(args['min-cases'] ?? (write ? 100 : 1));

if (!inputPath) {
  fail('missing --input <path> or BUSINESS_REGRESSION_IMPORT');
}

const payload = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const items = Array.isArray(payload) ? payload : payload.items;
if (!Array.isArray(items)) {
  fail('input must be an array or an object with items[]');
}

const normalized = items.map(normalizeItem);
const errors = validateDataset(normalized, minCases);
const departments = [...new Set(normalized.map((item) => item.department))].sort();
const categories = [...new Set(normalized.map((item) => item.category))].sort();

const report = {
  ok: errors.length === 0,
  mode: write ? 'write' : 'dry-run',
  inputPath: resolve(inputPath),
  outputPath,
  total: normalized.length,
  minCases,
  departments,
  categories,
  errors,
};

console.log(JSON.stringify(report, null, 2));

if (errors.length > 0) {
  process.exitCode = 1;
} else if (write) {
  const output = {
    version: payload.version ?? new Date().toISOString().slice(0, 10),
    description:
      payload.description ??
      'Imported business regression dataset. Keep private source material out of git unless it is explicitly sanitized.',
    total: normalized.length,
    items: normalized,
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}

function normalizeItem(item, index) {
  const expectedClaims = Array.isArray(item.expectedClaims)
    ? item.expectedClaims.map((claim) => ({
        text: String(claim.text ?? '').trim(),
        supportKeywords: arrayOfStrings(claim.supportKeywords),
      }))
    : [];

  return {
    id: String(item.id ?? `business-${String(index + 1).padStart(3, '0')}`).trim(),
    category: String(item.category ?? 'business-qa').trim(),
    department: String(item.department ?? 'unknown').trim(),
    documentType: String(item.documentType ?? 'unknown').trim(),
    query: String(item.query ?? '').trim(),
    referenceAnswer: String(item.referenceAnswer ?? '').trim(),
    referenceReferences: Array.isArray(item.referenceReferences)
      ? item.referenceReferences
      : [],
    expectedClaims,
    expectedKeywords: arrayOfStrings(item.expectedKeywords),
    minKeywordCoverage:
      typeof item.minKeywordCoverage === 'number' ? item.minKeywordCoverage : 0.5,
    requireCitation: item.requireCitation !== false,
    expectRefusal: Boolean(item.expectRefusal),
    expectConflictHandling: Boolean(item.expectConflictHandling),
    sourceDocument: normalizeSourceDocument(item.sourceDocument, index),
    ordinal: Number(item.ordinal ?? index + 1),
  };
}

function normalizeSourceDocument(sourceDocument, index) {
  if (!sourceDocument || typeof sourceDocument !== 'object') {
    return undefined;
  }
  return {
    id: String(sourceDocument.id ?? `business-${String(index + 1).padStart(3, '0')}-doc`).trim(),
    title: String(sourceDocument.title ?? '').trim(),
    content: String(sourceDocument.content ?? '').trim(),
    referenceIndex: Number(sourceDocument.referenceIndex ?? 1),
  };
}

function validateDataset(items, min) {
  const errors = [];
  if (items.length < min) {
    errors.push(`dataset has ${items.length} cases, expected at least ${min}`);
  }

  const ids = new Set();
  for (const [index, item] of items.entries()) {
    const label = item.id || `item[${index}]`;
    if (!item.id) errors.push(`${label}: id is required`);
    if (ids.has(item.id)) errors.push(`${label}: duplicated id`);
    ids.add(item.id);
    if (!item.query) errors.push(`${label}: query is required`);
    if (!item.referenceAnswer) errors.push(`${label}: referenceAnswer is required`);
    if (!item.department) errors.push(`${label}: department is required`);
    if (!item.documentType) errors.push(`${label}: documentType is required`);
    if (!item.expectedClaims.length) errors.push(`${label}: expectedClaims[] is required`);
    if (!item.expectedKeywords.length) errors.push(`${label}: expectedKeywords[] is required`);
    if (item.minKeywordCoverage < 0 || item.minKeywordCoverage > 1) {
      errors.push(`${label}: minKeywordCoverage must be between 0 and 1`);
    }
    for (const [claimIndex, claim] of item.expectedClaims.entries()) {
      if (!claim.text) errors.push(`${label}: expectedClaims[${claimIndex}].text is required`);
      if (!claim.supportKeywords.length) {
        errors.push(`${label}: expectedClaims[${claimIndex}].supportKeywords[] is required`);
      }
    }
    if (item.sourceDocument) {
      if (!item.sourceDocument.title) errors.push(`${label}: sourceDocument.title is required`);
      if (!item.sourceDocument.content) errors.push(`${label}: sourceDocument.content is required`);
    }
  }
  return errors;
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--write') {
      parsed.write = true;
    } else if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = values[index + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        index += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
