import { splitHybridDocument } from './hybrid-document-chunker';
import { parseCodeSource } from './code-parser.util';
import { parseCodeArchive } from './code-archive.util';
import JSZip from 'jszip';

describe('Code RAG chunking integration', () => {
  it('separates methods while retaining path, symbol and line-level provenance', async () => {
    const source = [
      'class UserService {',
      '  createUser(name: string) { return name; }',
      '  getUser(id: string) { return id; }',
      '}',
    ].join('\n');
    const parsed = parseCodeSource(Buffer.from(source), 'src/user.service.ts');
    const chunks = await splitHybridDocument({
      docId: 'code-doc-001', filename: 'src/user.service.ts',
      content: parsed.markdown, parsedDocument: parsed,
      chunkSize: 800, chunkOverlap: 80,
    });
    const create = chunks.find((chunk) => chunk.sourceMetadata.symbol?.includes('createUser'));
    const get = chunks.find((chunk) => chunk.sourceMetadata.symbol?.includes('getUser'));
    expect(create).toBeDefined();
    expect(get).toBeDefined();
    expect(create?.parentChunkId).not.toBe(get?.parentChunkId);
    expect(create?.sourceMetadata.filePath).toBe('src/user.service.ts');
    expect(create?.sourceMetadata.language).toBe('typescript');
    expect(create?.sourceMetadata.startLine).toBeGreaterThanOrEqual(1);
  });

  it('keeps same-named functions from separate ZIP files in separate parent chunks', async () => {
    const zip = new JSZip();
    zip.file('api/user.ts', 'export function load() { return 1; }');
    zip.file('web/user.ts', 'export function load() { return 2; }');
    const parsed = await parseCodeArchive(await zip.generateAsync({ type: 'nodebuffer' }), 'repo.zip');
    const chunks = await splitHybridDocument({
      docId: 'repo-doc-001', filename: 'repo.zip', content: parsed.markdown,
      parsedDocument: parsed, chunkSize: 800, chunkOverlap: 80,
    });
    const a = chunks.find((chunk) => chunk.sourceMetadata.filePath === 'api/user.ts' && chunk.sourceMetadata.symbol === 'load');
    const b = chunks.find((chunk) => chunk.sourceMetadata.filePath === 'web/user.ts' && chunk.sourceMetadata.symbol === 'load');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.parentChunkId).not.toBe(b?.parentChunkId);
  });

  it('does not merge two long functions and keeps a bounded parent context', async () => {
    const body = Array.from({ length: 250 }, (_, i) => `  const value${i} = ${i};`).join('\n');
    const source = `function first() {\n${body}\n}\nfunction second() {\nreturn true;\n}`;
    const parsed = parseCodeSource(Buffer.from(source), 'functions.js');
    const chunks = await splitHybridDocument({
      docId: 'code-doc-003', filename: 'functions.js', content: parsed.markdown,
      parsedDocument: parsed, chunkSize: 400, chunkOverlap: 40,
    });
    const first = chunks.filter((chunk) => chunk.sourceMetadata.symbol === 'first');
    expect(first.length).toBeGreaterThan(1);
    expect(first.every((chunk) => (chunk.parentContent?.length ?? 0) <= 6000)).toBe(true);
    expect(first.every((chunk) => !chunk.content.includes('function second()'))).toBe(true);
    expect(chunks.some((chunk) => chunk.sourceMetadata.symbol === 'second')).toBe(true);
  });
});
