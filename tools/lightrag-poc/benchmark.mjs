#!/usr/bin/env node
/** Isolated LightRAG proof-of-concept. No production RAG traffic or documents are used. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { LightRagPocClient } from './client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[index + 1];
}
function containsAll(context, terms) {
  const normalized = context.toLocaleLowerCase();
  return terms.every(term => normalized.includes(term.toLocaleLowerCase()));
}

async function main() {
  if (args.includes('--help')) {
    console.log('Usage: node tools/lightrag-poc/benchmark.mjs [--ingest] [--fixture FILE] [--baseline FILE] [--out FILE] [--mode mix|local|global|hybrid|naive]');
    return;
  }
  const fixturePath = resolve(arg('--fixture') ?? join(here, 'fixtures.json'));
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (!Array.isArray(fixture.documents) || !Array.isArray(fixture.cases)) {
    throw new Error('Fixture must have documents[] and cases[]');
  }
  const client = new LightRagPocClient({
    baseUrl: process.env.LIGHTRAG_POC_URL ?? 'http://127.0.0.1:9621',
    apiKey: process.env.LIGHTRAG_POC_API_KEY,
    timeoutMs: Number(process.env.LIGHTRAG_POC_TIMEOUT_MS ?? 60_000),
  });
  const remote = !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(client.baseUrl).hostname);
  if (remote && process.env.LIGHTRAG_POC_ALLOW_REMOTE !== 'true') {
    throw new Error('Remote LightRAG endpoint requires LIGHTRAG_POC_ALLOW_REMOTE=true');
  }
  if (remote && new URL(client.baseUrl).protocol !== 'https:') {
    throw new Error('Remote LightRAG endpoint must use HTTPS to protect the API key');
  }

  if (args.includes('--ingest')) {
    // Prevent accidental copying of real private documents into a shared workspace.
    if (process.env.LIGHTRAG_POC_ISOLATED_WORKSPACE !== 'I_ACKNOWLEDGE_ISOLATED_TEST_DATA') {
      throw new Error('Ingestion requires LIGHTRAG_POC_ISOLATED_WORKSPACE=I_ACKNOWLEDGE_ISOLATED_TEST_DATA');
    }
    for (const doc of fixture.documents) {
      if (!doc || typeof doc.source !== 'string' || typeof doc.text !== 'string') {
        throw new Error('Each fixture document requires source and text strings');
      }
      const result = await client.insertText({ fileSource: doc.source, text: doc.text });
      console.log(`Queued fixture ${doc.source}: track_id=${result.track_id ?? 'unavailable'}`);
    }
    console.log('LightRAG indexes asynchronously. Verify processing has completed in its WebUI or track-status API before running this benchmark without --ingest.');
    return;
  }

  const mode = arg('--mode') ?? 'mix';
  const baselineFile = arg('--baseline');
  // Optional comparison file: {"case-id":"retrieved context string",...}.
  const baseline = baselineFile ? JSON.parse(await readFile(resolve(baselineFile), 'utf8')) : null;
  const results = [];
  for (const testCase of fixture.cases) {
    if (!testCase || typeof testCase.id !== 'string' || typeof testCase.query !== 'string' || !Array.isArray(testCase.mustInclude) || !testCase.mustInclude.every(item => typeof item === 'string')) {
      throw new Error('Each test case requires id, query, and string[] mustInclude');
    }
    const began = performance.now();
    try {
      const result = await client.queryContext({ query: testCase.query, mode });
      results.push({
        id: testCase.id,
        hit: containsAll(result.context, testCase.mustInclude),
        baselineHit: baseline ? containsAll(String(baseline[testCase.id] ?? ''), testCase.mustInclude) : null,
        elapsedMs: Math.round(performance.now() - began),
        referenceCount: result.references.length,
      });
    } catch (error) {
      results.push({ id: testCase.id, hit: false, baselineHit: baseline ? containsAll(String(baseline[testCase.id] ?? ''), testCase.mustInclude) : null, elapsedMs: Math.round(performance.now() - began), error: error.message });
    }
  }
  const measured = results.filter(row => !row.error);
  const output = {
    mode,
    dataset: fixturePath,
    caveat: 'Keyword coverage of returned context is NOT Recall@K, answer accuracy, nor a production ACL/quality proof.',
    cases: results.length,
    successfulRequests: measured.length,
    contextKeywordCoverage: results.length ? results.filter(row => row.hit).length / results.length : 0,
    baselineKeywordCoverage: baseline && results.length ? results.filter(row => row.baselineHit).length / results.length : null,
    results,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (arg('--out')) await writeFile(resolve(arg('--out')), serialized, 'utf8');
  console.log(serialized);
}
main().catch(error => { console.error(`POC failed: ${error.message}`); process.exitCode = 1; });
