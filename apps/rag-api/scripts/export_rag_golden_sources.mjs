/**
 * RAG Golden evidence sample exporter (read-only, PostgreSQL + optional Milvus).
 * Put in apps/rag-api/scripts/; execute from apps/rag-api.
 * Uses the real entity fields from monstereatai/RAG.
 * Never exports embedding vectors or user credentials.
 *
 * node scripts/export_rag_golden_sources.mjs --list
 * node scripts/export_rag_golden_sources.mjs --doc-ids 'id1,id2' --milvus
 * node scripts/export_rag_golden_sources.mjs --doc-ids 'id1,id2' --tenant-id 'tenant-id' --milvus
 */
import 'dotenv/config';
import pg from 'pg';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
function option(name, fallback = undefined) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return argv[i + 1];
}
function positiveInt(value, name, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return number;
}
const help = `\nRead-only RAG Golden evidence exporter (PostgreSQL + Milvus)\n\n` +
  `  node scripts/export_rag_golden_sources.mjs --list [--tenant-id TENANT]\n` +
  `  node scripts/export_rag_golden_sources.mjs --doc-ids id1,id2 [--tenant-id TENANT] [--milvus] [--out FILE]\n\n` +
  `Required: POSTGRES_URL (in .env or environment)\n` +
  `Milvus (optional): MILVUS_HOST, MILVUS_PORT, MILVUS_COLLECTION; default 127.0.0.1:19530/rag_chunks\n` +
  `No full vector export. Source content must be manually sanitized before sharing.\n`;
if (flag('--help') || flag('-h')) {
  console.log(help);
  process.exit(0);
}
if (flag('--list') === flag('--doc-ids')) {
  throw new Error(`Specify exactly one of --list or --doc-ids.\n${help}`);
}
if (flag('--milvus') && flag('--list')) {
  throw new Error('--milvus is only valid with --doc-ids');
}
if (process.env.RELATIONAL_DB_PROVIDER === 'mysql') {
  throw new Error('Current export script targets PostgreSQL. Your RELATIONAL_DB_PROVIDER=mysql requires a MySQL version.');
}
const connectionString = process.env.POSTGRES_URL;
if (!connectionString || !/^postgres(?:ql)?:\/\//i.test(connectionString)) {
  throw new Error('POSTGRES_URL is required and must use postgres:// or postgresql://. Do not share this URL.');
}
const tenantId = option('--tenant-id');
const docIds = flag('--list') ? [] : [...new Set(option('--doc-ids').split(',').map(s => s.trim()).filter(Boolean))];
if (!flag('--list') && (docIds.length < 1 || docIds.length > 10)) {
  throw new Error('Choose 1..10 explicit document IDs using --doc-ids');
}
const outputFile = resolve(option('--out', '.tmp/golden-export/knowledge-sample.json'));
const maxBytes = 25 * 1024 * 1024;
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 5_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
});
const hash = (text) => createHash('sha256').update(text).digest('hex');
const fmtDate = (value) => value instanceof Date ? value.toISOString() : value ?? null;
const batchesOf = (a, size) => Array.from({length: Math.ceil(a.length / size)}, (_,i)=>a.slice(i*size,(i+1)*size));
function useTenantFilter(alias) {
  // Tenant-scoped when explicitly requested; otherwise doc IDs must be authorized by operator.
  return tenantId ? ` AND ${alias}."tenantId" = $2` : '';
}
let client;
try {
  if (flag('--list')) {
    const limit = positiveInt(option('--limit', '20'), '--limit', 100);
    const params = tenantId ? [limit, tenantId] : [limit];
    const result = await pool.query({
      text: `SELECT m."docId", m."filename", m."title", m."chunkCount", m."docVersion", m."lifecycleStatus", m."reviewStatus", m."createdAt"\n` +
        `FROM documents_meta m WHERE 1=1 ${useTenantFilter('m')} ORDER BY m."createdAt" DESC LIMIT $1`,
      values: params,
    });
    console.log(JSON.stringify({ count: result.rows.length, tenantScoped: Boolean(tenantId), documents: result.rows }, null, 2));
  } else {
    const params = tenantId ? [docIds, tenantId] : [docIds];
    const metadata = await pool.query({
      text: `SELECT m."docId", m."filename", m."title", m."docVersion", m."effectiveAt", m."expiredAt",\n` +
        `m."sourceAuthority", m."lifecycleStatus", m."reviewStatus", m."projectId", m."activityId",\n` +
        `m."documentType", m."chunkCount", m."contentHash", m."indexGeneration"\n` +
        `FROM documents_meta m WHERE m."docId" = ANY($1::varchar[]) ${useTenantFilter('m')}`,
      values: params,
    });
    const found = new Map(metadata.rows.map(row => [row.docId, row]));
    const missing = docIds.filter(docId => !found.has(docId));
    if (missing.length) {
      throw new Error(`${missing.length} selected document(s) not found or unavailable for tenant: ${missing.join(', ')}`);
    }
    const chunks = await pool.query({
      text: `SELECT c."id", c."docId", c."chunkIndex", c."chunkType", c."parentChunkId", c."content",\n` +
        `c."docVersion", c."effectiveAt", c."expiredAt", c."lifecycleStatus", c."documentType",\n` +
        `c."headingPath", c."sectionId", c."sourceStart", c."sourceEnd", c."contentHash"\n` +
        `FROM document_chunks c WHERE c."docId" = ANY($1::varchar[]) ${useTenantFilter('c')}\n` +
        `ORDER BY c."docId", c."chunkIndex", c."id"`,
      values: params,
    });
    const byDoc = new Map(docIds.map(id => [id, []]));
    for (const c of chunks.rows) byDoc.get(c.docId)?.push(c);
    let milvusStatus = { checked: false, note: 'Use --milvus to cross-check selected chunk IDs; no embeddings are exported.' };
    let indexedIds = new Set();
    let mismatchedIds = [];
    if (flag('--milvus')) {
      const collection = process.env.MILVUS_COLLECTION || 'rag_chunks';
      const host = process.env.MILVUS_HOST || '127.0.0.1';
      const port = positiveInt(process.env.MILVUS_PORT || '19530', 'MILVUS_PORT', 65535);
      client = new MilvusClient({ address: `${host}:${port}` });
      await client.connectPromise;
      const present = await client.hasCollection({ collection_name: collection });
      if (!present.value) throw new Error(`Milvus collection ${collection} does not exist`);
      await client.loadCollection({ collection_name: collection });
      // Only leaf IDs: parent chunks may not have vectors by design.
      const leaves = chunks.rows.filter(c => c.chunkType !== 'parent');
      for (const batch of batchesOf(leaves, 100)) {
        const result = await client.get({ collection_name: collection, ids: batch.map(c => c.id), output_fields: ['id', 'doc_id', 'chunk_index'] });
        if (!Array.isArray(result.data)) throw new Error('Milvus returned no data array for ID lookup');
        for (const row of result.data) {
          const expected = batch.find(c => c.id === String(row.id));
          if (!expected) continue;
          if (String(row.doc_id) !== String(expected.docId)) {
            mismatchedIds.push(expected.id);
            continue;
          }
          indexedIds.add(expected.id);
        }
      }
      milvusStatus = {
        checked: true, collection,
        leafCount: leaves.length,
        indexedLeafCount: indexedIds.size,
        missingLeafCount: leaves.length - indexedIds.size,
        mismatchedDocCount: mismatchedIds.length,
        // Never export vectors, connection credentials, or full collection contents.
      };
    }
    const documents = docIds.map(docId => {
      const meta = found.get(docId);
      const rows = byDoc.get(docId);
      return {
        docId,
        filename: meta.filename,
        title: meta.title,
        docVersion: meta.docVersion,
        effectiveAt: fmtDate(meta.effectiveAt),
        expiredAt: fmtDate(meta.expiredAt),
        sourceAuthority: meta.sourceAuthority,
        lifecycleStatus: meta.lifecycleStatus,
        reviewStatus: meta.reviewStatus,
        documentType: meta.documentType,
        projectId: meta.projectId,
        activityId: meta.activityId,
        // This is a checksum of exported PostgreSQL chunks, NOT the hash of original source files.
        exportedChunksSha256: hash(rows.map(row => `${row.id}\n${row.content}`).join('\n')),
        sourceUri: null, // Must be confirmed from original evidence; do not fabricate a source URL.
        sourceSnapshotAttested: false,
        chunks: rows.map(row => ({
          id: row.id, chunkId: row.id, docId: row.docId, chunkIndex: row.chunkIndex,
          chunkType: row.chunkType,
          parentChunkId: row.parentChunkId,
          content: row.content,
          docVersion: row.docVersion,
          effectiveAt: fmtDate(row.effectiveAt),
          expiredAt: fmtDate(row.expiredAt),
          lifecycleStatus: row.lifecycleStatus,
          documentType: row.documentType,
          headingPath: row.headingPath,
          sectionId: row.sectionId,
          sourceStart: row.sourceStart,
          sourceEnd: row.sourceEnd,
          indexedInMilvus: flag('--milvus') && row.chunkType !== 'parent' ? indexedIds.has(row.id) : null,
        })),
      };
    });
    const payload = {
      kind: 'unreviewed-private-rag-source-export',
      generatedAt: new Date().toISOString(),
      origin: { primarySource: 'postgresql.documents_meta+document_chunks', vectorCheck: 'Milvus ID-only lookup', tenantScoped: Boolean(tenantId) },
      status: 'UNREVIEWED_NOT_A_GOLDEN_RELEASE',
      milvus: milvusStatus,
      warnings: [
        'This file contains potentially confidential document content. Manually sanitize before sharing.',
        'sourceUri=null and sourceSnapshotAttested=false; original source evidence and human review are required for Golden release.',
        'Milvus presence confirms vector index membership only, not relevance, ACL correctness or answer quality.',
      ],
      documents,
    };
    const serialized = JSON.stringify(payload, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      throw new Error('Export exceeds 25 MB. Select fewer document IDs (nothing was written).');
    }
    await mkdir(dirname(outputFile), { recursive: true, mode: 0o700 });
    await writeFile(outputFile, serialized, { mode: 0o600, flag: 'w' });
    await chmod(outputFile, 0o600);
    console.log(JSON.stringify({ savedTo: outputFile, docs: documents.length,
      chunks: chunks.rows.length, milvus: milvusStatus, warning: 'Review and sanitize JSON before sending to ChatGPT.' }, null, 2));
  }
} finally {
  await client?.closeConnection().catch(() => undefined);
  await pool.end();
}
