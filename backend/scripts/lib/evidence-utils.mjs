import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function average(values, emptyValue = 0) {
  if (values.length === 0) return emptyValue;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function rate(passed, total) {
  return total === 0 ? 0 : round(passed / total);
}

export function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

export function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

export async function writeEvidenceReport(outputPath, report, markdown) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (markdown !== undefined) {
    const markdownPath = outputPath.replace(/\.json$/i, '.md');
    await writeFile(markdownPath, `${markdown.trim()}\n`, 'utf8');
  }
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer ***')
    .replace(/(access[_-]?token["'=:\s]+)[^\s",}]+/gi, '$1***')
    .replace(
      /((?:api[_-]?key|secret|password|token)["'=:\s]+)[^\s",}]+/gi,
      '$1***',
    )
    .slice(0, 500);
}
