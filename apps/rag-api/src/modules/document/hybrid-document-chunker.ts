import { createHash } from 'node:crypto';
import { MarkdownChunker, type StructuredChunk } from './chunking.util';
import type { ParsedBlock, ParsedDocument } from './document-parser.types';

/**
 * Structure-aware hybrid chunking:
 * 1. Preserve records / API contracts / test cases / table rows as atomic units.
 * 2. Split oversized units *inside* their boundary using the existing token-aware chunker.
 * 3. Attach a bounded parent context reference for retrieval-time expansion; parents are not embedded.
 * 4. Keep source and attachment references alongside each child.
 */
export interface ChunkProvenance {
  filename: string;
  kind: string;
  pageNumber?: number;
  slideNumber?: number;
  sheetName?: string;
  rowStart?: number;
  rowEnd?: number;
  startSeconds?: number;
  endSeconds?: number;
  recordId?: string;
  assetRefs?: string[];
}

interface LogicalUnit {
  content: string;
  path: string[];
  group: string;
  source: ChunkProvenance;
  atomic: boolean;
  start: number | null;
  end: number | null;
}

export interface HybridChunk extends StructuredChunk {
  parentContent: string | null;
  sourceMetadata: ChunkProvenance;
}

const IMAGE_REF = /!\[[^\]]*\]\(([^)]+)\)/g;
const MAX_PARENT_CHARS = 6_000;
const MAX_ATTACHMENT_REFS = 40;

function boundedParent(text: string, child: string): string {
  if (text.length <= MAX_PARENT_CHARS) return text;
  // Pick a window around the hit instead of always keeping the beginning:
  // an oversized requirement may have its relevant constraint near the end.
  const normalizedChild = child.replace(/^知识路径：[^\n]*\n/, '').trim();
  const needle = normalizedChild.slice(0, Math.min(normalizedChild.length, 140));
  const offset = needle ? text.indexOf(needle) : -1;
  const start = offset < 0 ? 0 : Math.min(Math.max(0, offset - 1_500), text.length - MAX_PARENT_CHARS);
  return `【父级上下文节选；完整内容请参考原始文档】\n${text.slice(start, start + MAX_PARENT_CHARS - 35)}`;
}


function assetsOf(text: string, block?: ParsedBlock): string[] {
  const assets = [...text.matchAll(IMAGE_REF)].map((match) => match[1].trim());
  if (block?.asset?.url) assets.push(block.asset.url);
  return [...new Set(assets.filter((item) => item.length > 0))].slice(0, MAX_ATTACHMENT_REFS);
}

function provenance(filename: string, kind: string, block?: ParsedBlock): ChunkProvenance {
  const meta = block?.metadata ?? {};
  const row = typeof meta.sourceRow === 'number' ? meta.sourceRow : undefined;
  return {
    filename, kind,
    ...(block?.pageNumber !== undefined ? { pageNumber: block.pageNumber } : {}),
    ...(block?.slideNumber !== undefined ? { slideNumber: block.slideNumber } : {}),
    ...(block?.sheetName ? { sheetName: block.sheetName } : {}),
    ...(row !== undefined ? { rowStart: row, rowEnd: row } : {}),
    ...(block?.startSeconds !== undefined ? { startSeconds: block.startSeconds } : {}),
    ...(block?.endSeconds !== undefined ? { endSeconds: block.endSeconds } : {}),
    ...(typeof meta.recordId === 'string' ? { recordId: meta.recordId } : {}),
    ...((assetsOf(block?.text ?? '', block).length > 0) ? { assetRefs: assetsOf(block?.text ?? '', block) } : {}),
  };
}

function pathFor(block: ParsedBlock, filename: string): string[] {
  return block.headingPath?.length ? block.headingPath : [filename];
}

function groupKey(source: ChunkProvenance, path: string[], atomic: boolean): string {
  if (source.sheetName && source.rowStart !== undefined) return `row:${source.sheetName}:${source.rowStart}`;
  if (source.recordId) return `record:${source.recordId}`;
  if (source.startSeconds !== undefined) return `time:${source.startSeconds}:${source.endSeconds ?? ''}`;
  if (source.pageNumber !== undefined) return `page:${source.pageNumber}:${path.join('/')}`;
  if (source.slideNumber !== undefined) return `slide:${source.slideNumber}`;
  return `${atomic ? 'atom' : 'section'}:${path.join('/')}`;
}

function tableUnits(block: ParsedBlock, filename: string, kind: string): LogicalUnit[] | null {
  // Native SheetJS/CSV/JSON tables are Markdown; MinerU Excel already emits atomic record blocks.
  const lines = block.text.split('\n').filter((line) => /^\s*\|.+\|\s*$/.test(line));
  if (lines.length < 3) return null;
  const split = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((s) => s.trim().replace(/\\\|/g, '|'));
  const header = split(lines[0]);
  if (header.length < 2 || !lines[1].includes('---')) return null;
  const start = typeof block.metadata?.startRow === 'number' ? block.metadata.startRow + 1 : undefined;
  return lines.slice(2).flatMap((line, index) => {
    const cells = split(line);
    if (!cells.some(Boolean)) return [];
    const row = start === undefined ? undefined : start + index;
    const source: ChunkProvenance = {
      filename, kind,
      ...(block.sheetName ? { sheetName: block.sheetName } : {}),
      ...(row === undefined ? {} : { rowStart: row, rowEnd: row }),
      assetRefs: assetsOf(line),
    };
    const record = header.map((name, i) => `${name || `列${i + 1}`}：${cells[i] ?? ''}`).join('\n');
    const content = `${row === undefined ? '表格记录' : `第 ${row} 行`}\n${record}`;
    const path = [...pathFor(block, filename), `记录${row ?? index + 1}`];
    return [{ content, path, group: groupKey(source, path, true), source, atomic: true, start: null, end: null }];
  });
}

function classifyAtomic(block: ParsedBlock): boolean {
  if (block.metadata?.recordId || block.metadata?.sourceRow !== undefined) return true;
  if (block.type === 'table' || block.type === 'chart') return true;
  if (block.type === 'transcript' || block.type === 'frame') return true;
  const text = block.text;
  return /(?:^|\n)\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+/i.test(text) ||
    /(?:^|\n)\s*(?:测试用例|前置条件|验收标准|用例编号|规则编号)[：:]/.test(text);
}

function renderBlock(block: ParsedBlock): string {
  if (block.type === 'image' || block.type === 'frame') {
    if (block.asset?.url && !block.text.includes(block.asset.url))
      return [block.text, `![关联图片](${block.asset.url})`].filter(Boolean).join('\n');
  }
  return block.text.trim();
}

function businessMarker(text: string): string | null {
  const api = /(?:^|\n)\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s]+)/i.exec(text);
  if (api) return `api:${api[1].toUpperCase()}:${api[2]}`;
  const test = /(?:^|\n)\s*(?:测试用例|用例编号|测试编号)[：:]\s*([^\n]+)/.exec(text);
  if (test) return `test:${test[1].trim()}`;
  const rule = /(?:^|\n)\s*((?:第[一二三四五六七八九十百千万0-9]+条)|(?:\d+(?:\.\d+)*[、.]))\s*[^\n]*/.exec(text);
  if (rule) return `rule:${rule[1]}`;
  return null;
}

function normalizeTableBlocks(blocks: ParsedBlock[]): ParsedBlock[] {
  const merged: ParsedBlock[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (block.type === 'table' && previous?.type === 'table' &&
      block.headingPath?.join('/') === previous.headingPath?.join('/') &&
      !block.sheetName && !previous.sheetName &&
      /^\s*\|.*\|\s*$/.test(block.text) &&
      /^\s*\|.*\|\s*$/.test(previous.text)) {
      previous.text += '\n' + block.text;
      previous.sourceEnd = block.sourceEnd;
    } else merged.push({ ...block });
  }
  return merged;
}

function unitsFromParsed(parsed: ParsedDocument): LogicalUnit[] {
  const out: LogicalUnit[] = [];
  let currentPath: string[] = [parsed.title];
  let activeMarker: string | null = null;
  let activePath = '';
  let activeLocation = '';
  for (const block of normalizeTableBlocks(parsed.blocks)) {
    if (block.type === 'heading' || block.type === 'title') {
      if (block.headingPath?.length) currentPath = block.headingPath;
      else if (block.text.trim()) currentPath = [parsed.title, block.text.trim()];
      activeMarker = null;
      continue;
    }
    const text = renderBlock(block);
    if (!text) continue;
    const path = block.headingPath?.length ? block.headingPath : currentPath;
    const pathKey = path.join(' > ');
    const location = `${block.pageNumber ?? ''}/${block.slideNumber ?? ''}/${block.sheetName ?? ''}`;
    if (pathKey !== activePath || location !== activeLocation) {
      activeMarker = null;
      activePath = pathKey;
      activeLocation = location;
    }
    // Excel / CSV / JSON tables represent records; tables inside an API/test
    // section belong to the surrounding contract and must NOT split by row.
    if (block.type === 'table' && !activeMarker &&
        (parsed.kind === 'xlsx' || parsed.kind === 'xls' || parsed.kind === 'csv' || parsed.kind === 'json')) {
      const records = tableUnits(block, parsed.title, parsed.kind);
      if (records?.length) { out.push(...records); continue; }
    }
    const source = provenance(parsed.title, parsed.kind, block);
    const marker = businessMarker(text);
    if (marker) activeMarker = marker;
    // Explicit record blocks always form their OWN parent. Markers such as
    // GET /api or case IDs attach the following paragraphs/tables in scope.
    const isRecord = source.recordId !== undefined || source.rowStart !== undefined;
    const group = isRecord
      ? groupKey(source, path, true)
      : activeMarker ? `${pathKey}:${location}:${activeMarker}` : groupKey(source, path, classifyAtomic(block));
    const atomic = isRecord || !!activeMarker || classifyAtomic(block);
    out.push({ content: text, path, group, source, atomic, start: block.sourceStart ?? null, end: block.sourceEnd ?? null });
  }
  return out;
}

function mergeProvenance(items: LogicalUnit[]): ChunkProvenance {
  const source: ChunkProvenance = { ...items[0].source };
  const refs = new Set<string>();
  for (const item of items) {
    for (const ref of item.source.assetRefs ?? []) refs.add(ref);
    if (item.source.pageNumber !== source.pageNumber) delete source.pageNumber;
    if (item.source.slideNumber !== source.slideNumber) delete source.slideNumber;
    if (item.source.sheetName !== source.sheetName) delete source.sheetName;
    if (item.source.rowStart !== source.rowStart) delete source.rowStart;
    if (item.source.rowEnd !== source.rowEnd) delete source.rowEnd;
    if (item.source.startSeconds !== undefined) source.startSeconds = Math.min(source.startSeconds ?? item.source.startSeconds, item.source.startSeconds);
    if (item.source.endSeconds !== undefined) source.endSeconds = Math.max(source.endSeconds ?? item.source.endSeconds, item.source.endSeconds);
  }
  source.assetRefs = [...refs].slice(0, MAX_ATTACHMENT_REFS);
  return source;
}

function coalesce(units: LogicalUnit[]): LogicalUnit[] {
  // Merge adjacent free-text paragraphs in the same structural scope; never merge business records.
  const out: LogicalUnit[] = [];
  for (const unit of units) {
    const last = out.at(-1);
    const canMerge = last && last.group === unit.group &&
      (!last.atomic && !unit.atomic || /:(?:api|test|rule):/.test(unit.group));
    if (canMerge && last.content.length + unit.content.length < 16_000) {
      last.content += '\n\n' + unit.content;
      last.end = unit.end ?? last.end;
      last.source = mergeProvenance([last, unit]);
    } else out.push({ ...unit });
  }
  return out;
}

/** Preserve structure where possible; existing Markdown semantic splitter remains a safe fallback. */
export async function splitHybridDocument(input: {
  docId: string;
  filename: string;
  content: string;
  parsedDocument?: ParsedDocument;
  chunkSize: number;
  chunkOverlap: number;
}): Promise<HybridChunk[]> {
  const splitter = new MarkdownChunker(input.chunkSize, input.chunkOverlap, true);
  const parsed = input.parsedDocument;
  // Plain markdown already has an effective outline-aware splitter. Use it as-is unless an
  // actual structured source is available; still attach a real materialized parent payload.
  let units = parsed?.blocks.length ? coalesce(unitsFromParsed(parsed)) : [];
  if (!units.length) {
    const chunks = await splitter.splitStructured(input.content);
    // Materialize the complete heading section as the parent, not the child
    // repeated under a parent-looking identifier.
    const sections = new Map<number, string[]>();
    let sectionIndex = -1;
    for (const line of input.content.split('\n')) {
      if (/^#{1,6}\s+/.test(line) || sectionIndex < 0) {
        sectionIndex += 1;
        sections.set(sectionIndex, []);
      }
      sections.get(sectionIndex)?.push(line);
    }
    return chunks.map((chunk, i) => {
      const section = Number(chunk.sectionId?.replace(/^section-/, '') ?? 0);
      const parent = (sections.get(Number.isFinite(section) ? section : 0) ?? [chunk.content]).join('\n');
      const parentContent = boundedParent(parent, chunk.content);
      const parentId =
        parentContent === chunk.content
          ? null
          : createHash('sha256')
              .update(`${input.docId}:section:${section}:${parentContent}`)
              .digest('hex')
              .slice(0, 36);
      return {
        ...chunk,
        chunkIndex: i,
        parentChunkId: parentId,
        parentContent,
        sourceMetadata: { filename: input.filename, kind: parsed?.kind ?? 'text', assetRefs: assetsOf(chunk.content) },
      };
    });
  }

  const groupContents = new Map<string, string[]>();
  for (const unit of units) {
    const bucket = groupContents.get(unit.group) ?? [];
    bucket.push(unit.content);
    groupContents.set(unit.group, bucket);
  }

  const output: HybridChunk[] = [];
  for (const unit of units) {
    const prefix = unit.path.length > 0 ? `知识路径：${unit.path.join(' > ')}\n` : '';
    // Atomic records use their own boundary; oversized ones split *within that record*.
    const inputText = `${prefix}${unit.content}`;
    const parts = await splitter.splitStructured(inputText);
    if (!parts.length) continue;
    const groupId = createHash('sha256')
      .update(`${input.docId}:${unit.group}`)
      .digest('hex')
      .slice(0, 36);
    const rawParent = (groupContents.get(unit.group) ?? [unit.content]).join('\n\n');
    const parent = `${prefix}${rawParent}`;
    for (const part of parts) {
      const source = {
        ...unit.source,
        assetRefs: [...new Set([...(unit.source.assetRefs ?? []), ...assetsOf(unit.content)])].slice(0, MAX_ATTACHMENT_REFS),
      };
      const parentContent = boundedParent(parent, part.content);
      const parentId =
        parentContent === part.content
          ? null
          : createHash('sha256')
              .update(`${input.docId}:${unit.group}:${parentContent}`)
              .digest('hex')
              .slice(0, 36);
      output.push({
        ...part,
        content: part.content,
        chunkIndex: output.length,
        parentChunkId: parentId,
        sectionId: groupId,
        headingPath: unit.path,
        tableRef: unit.atomic && unit.source.sheetName ? unit.source.sheetName : part.tableRef,
        sourceStart: unit.start,
        sourceEnd: unit.end,
        parentContent,
        sourceMetadata: source,
      });
    }
  }
  return output;
}
