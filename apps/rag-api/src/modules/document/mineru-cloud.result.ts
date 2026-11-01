import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { createParsedDocument } from './document-parser.util';
import type {
  DocumentImageExtractionOptions,
  ParsedBlock,
  ParsedDocument,
  ParsedDocumentWarning,
  SupportedDocumentKind,
} from './document-parser.types';

interface MineruPage { page_idx?: number; para_blocks?: unknown[] }
interface MineruContent { pdf_info?: MineruPage[] }
interface MineruTable { sheet: string; html: string }
interface ParsedCell { label: string; text: string; images: string[] }
interface ExcelRowLocator {
  find(sheet: string, headers: string[], cells: string[]): number | null;
}

const MAX_IMAGES = 120;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const HTML_TABLE = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
const HTML_ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const HTML_CELL = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/gi;

/** MinerU 的 Office JSON 中，pdf_info 的一个 page 通常代表一个 Sheet，而非原 Excel 页码。 */
function tablesFromJson(json: unknown): MineruTable[] {
  if (!json || typeof json !== 'object') return [];
  const pages = (json as MineruContent).pdf_info;
  if (!Array.isArray(pages)) return [];
  const tables: MineruTable[] = [];
  for (const page of pages) {
    const blocks = Array.isArray(page.para_blocks) ? page.para_blocks : [];
    let sheet = `Sheet${(page.page_idx ?? tables.length) + 1}`;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const item = block as { type?: string; blocks?: unknown[]; lines?: unknown[] };
      const collectSpans = (lines: unknown[] | undefined): Array<Record<string, unknown>> => {
        if (!Array.isArray(lines)) return [];
        return lines.flatMap((line) => {
          const spans = (line as { spans?: unknown[] })?.spans;
          return Array.isArray(spans) ? spans.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
        });
      };
      if (item.type === 'title') {
        const title = collectSpans(item.lines).map(s => typeof s.content === 'string' ? s.content : '').join(' ').trim();
        if (title) sheet = title;
      }
      if (item.type === 'table') {
        const inner = Array.isArray(item.blocks) ? item.blocks : [];
        for (const section of inner) {
          const spans = collectSpans((section as { lines?: unknown[] })?.lines);
          for (const span of spans) {
            if (typeof span.html === 'string' && /<table\b/i.test(span.html)) {
              const htmlTables = span.html.match(HTML_TABLE) ?? [];
              for (const html of htmlTables) tables.push({ sheet, html });
            }
          }
        }
      }
    }
  }
  return tables;
}

function tablesFromMarkdown(markdown: string): MineruTable[] {
  const out: MineruTable[] = [];
  let sheet = 'Sheet1';
  for (const part of markdown.split(/(?=<table\b|^#{1,3}\s)/gim)) {
    const h = /^#{1,3}\s+([^\n]+)/.exec(part);
    if (h) sheet = h[1].trim();
    const matches = part.match(HTML_TABLE) ?? [];
    for (const html of matches) out.push({ sheet, html });
  }
  // Simple fallback when HTML was not split neatly by Markdown headings.
  if (out.length === 0) {
    const matches = markdown.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi);
    for (const match of matches) {
      const prefix = markdown.slice(0, match.index);
      sheet = [...prefix.matchAll(/^#{1,3}\s+([^\n]+)/gm)].at(-1)?.[1]?.trim() || 'Sheet1';
      out.push({ sheet, html: match[0] });
    }
  }
  return out;
}

function decodeHtml(text: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, value: string) => {
    const lower = value.toLowerCase();
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return entities[lower] ?? all;
  });
}
function cleanHtml(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim());
}
function parseRows(html: string): ParsedCell[][] {
  const rows: ParsedCell[][] = [];
  for (const row of html.matchAll(HTML_ROW)) {
    const cells: ParsedCell[] = [];
    for (const cell of row[1].matchAll(HTML_CELL)) {
      const images = [...cell[2].matchAll(HTML_IMAGE)].map(m => decodeHtml(m[1]));
      const text = cleanHtml(cell[2].replace(HTML_IMAGE, ''));
      cells.push({ label: cell[1].toLowerCase(), text, images });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}
function normalize(v: string): string { return v.toLowerCase().replace(/[\s\u00a0|:：]+/g, '').trim(); }

/** 精确行号来自原始 Excel；无法无歧义对应时不杜撰行号。 */
function createExcelLocator(originalBuffer: Buffer | undefined, warnings: ParsedDocumentWarning[]): ExcelRowLocator | null {
  if (!originalBuffer) return null;
  try {
    const workbook = XLSX.read(originalBuffer, { type: 'buffer', WTF: true });
    const used = new Map<string, Set<number>>();
    return {
      find(sheetName, headers, cells) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet || !sheet['!ref']) return null;
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
        const records = rows.map(row => row.map(v => normalize(String(v ?? ''))));
        const normalizedHeaders = headers.map(normalize);
        let headerIndex = -1;
        for (let i = 0; i < Math.min(40, rows.length); i++) {
          const row = records[i];
          const exact = normalizedHeaders.filter(h => h && row.includes(h)).length;
          if (exact >= Math.min(2, normalizedHeaders.filter(Boolean).length)) { headerIndex = i; break; }
        }
        if (headerIndex < 0) return null;
        const taken = used.get(sheetName) ?? new Set<number>();
        used.set(sheetName, taken);
        const nonempty = cells.map((v,i) => ({ value: normalize(v), idx: i })).filter(x => x.value);
        // Use values, not ordinal position; escaped/merged cells can shift column positions.
        const candidates: number[] = [];
        for (let rowIndex = headerIndex + 1; rowIndex < records.length; rowIndex++) {
          if (taken.has(rowIndex)) continue;
          const values = records[rowIndex];
          const matched = nonempty.filter(item => values.includes(item.value)).length;
          if (matched >= Math.min(2, nonempty.length) && matched > 0) candidates.push(rowIndex);
        }
        if (candidates.length === 0) return null;
        const selected = candidates[0];
        taken.add(selected);
        return range.s.r + selected + 1;
      },
    };
  } catch {
    warnings.push({ code: 'mineru_excel_locator_failed', message: '原始 Excel 单元格定位失败，已保留工作表和记录序号。' });
    return null;
  }
}

function safeName(src: string): string | null {
  try {
    const path = src.startsWith('http') ? new URL(src).pathname : src.split('?')[0];
    const decoded = decodeURIComponent(path).replace(/\\/g, '/');
    const name = decoded.split('/').pop() ?? '';
    if (!/^[\w.\-]{1,180}\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name)) return null;
    return name;
  } catch { return null; }
}
function mimeFor(data: Buffer): { type: string; ext: string } | null {
  if (data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return { type: 'image/png', ext: 'png' };
  if (data.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))) return { type: 'image/jpeg', ext: 'jpg' };
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') return { type:'image/webp',ext:'webp' };
  if (data.subarray(0,3).toString() === 'GIF') return { type:'image/gif',ext:'gif' };
  return null;
}
function sanitize(value: string): string { return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g,'').slice(0,80) || 'anonymous'; }

async function materializeImage(
  src: string, zip: JSZip, images: DocumentImageExtractionOptions | undefined,
  docHash: string, warnings: ParsedDocumentWarning[], cache: Map<string,string>,
): Promise<string> {
  const filename = safeName(src);
  if (!filename) { warnings.push({ code: 'mineru_image_path_invalid', message: '忽略不安全的图片引用。' }); return '[图片引用无效]'; }
  if (cache.has(filename)) return cache.get(filename)!;
  if (cache.size >= MAX_IMAGES) { warnings.push({code:'mineru_image_limit',message:`图片超过 ${MAX_IMAGES} 张，剩余图片未入库。`}); return `[图片: ${filename}，未入库]`; }
  const matches = Object.values(zip.files).filter(f => !f.dir && f.name.split('/').pop() === filename);
  if (matches.length !== 1) {
    warnings.push({code:'mineru_image_missing',message:`解析包中未找到唯一的附件 ${filename}。`});
    return `[图片: ${filename}，资源缺失]`;
  }
  const entry = matches[0];
  const uncompressed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (uncompressed > MAX_IMAGE_BYTES) {
    warnings.push({code:'mineru_image_too_large',message:`图片 ${filename} 超过单张大小限制。`});
    return `[图片: ${filename}，过大未入库]`;
  }
  const bytes = await entry.async('nodebuffer');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('MinerU image exceeds byte limit');
  const mime = mimeFor(bytes);
  if (!mime) { warnings.push({code:'mineru_image_format_invalid',message:`图片 ${filename} 不是支持的实际图片格式。`}); return `[图片: ${filename}，格式不可用]`; }
  if (!images?.storage) { warnings.push({code:'mineru_image_storage_missing',message:`附件 ${filename} 无可用对象存储。`}); return `[图片: ${filename}，未持久化]`; }
  const key = `documents/${sanitize(images.ownerUserId ?? 'anonymous')}/mineru/${docHash}/images/${createHash('sha256').update(bytes).digest('hex').slice(0,24)}.${mime.ext}`;
  const stored = await images.storage.putObject({key,body:bytes,contentType:mime.type});
  const url = images.urlResolver ? images.urlResolver(stored) : stored.url;
  // This is a controlled storage URL, not MinerU's expiring CDN URL.
  const marker = `![附件截图](${url})`;
  let description = '';
  if (images.vision) {
    try {
      const reply = await images.vision.describeImage(bytes, mime.type, '简要描述截图中可用于检索的实际界面元素、文字和标注；不推断图片没有的信息。');
      description = reply.description?.trim() || '';
    } catch { warnings.push({code:'mineru_image_vision_failed',message:`附件 ${filename} 的图片理解失败，已保留原图。`}); }
  }
  const full = description ? `${marker}\n图片内容：${description}` : marker;
  cache.set(filename, full);
  return full;
}

export interface MineruParseSource {
  kind: SupportedDocumentKind;
  filename: string;
  markdown: string;
  json?: unknown;
  zip: JSZip;
  originalBuffer?: Buffer;
  images?: DocumentImageExtractionOptions;
}

/** Turns MinerU's tables into atomic row records; ordinary documents stay Markdown based. */
export async function convertMineruResult(input: MineruParseSource): Promise<ParsedDocument> {
  const warnings: ParsedDocumentWarning[] = [];
  const hash = createHash('sha256').update(input.originalBuffer ?? Buffer.from(input.markdown)).digest('hex').slice(0,20);
  const cache = new Map<string,string>();
  if (input.kind !== 'xlsx' && input.kind !== 'xls') {
    // Markdown sometimes contains image refs; rewrite to our existing ACL-checked OSS assets.
    const srcs = [...input.markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
    let markdown = input.markdown;
    for (const found of srcs) {
      const source = found[1] || found[2];
      const marker = await materializeImage(source, input.zip, input.images, hash, warnings, cache);
      markdown = markdown.replace(found[0], marker);
    }
    const result = createParsedDocument(input.kind, input.filename, markdown, warnings);
    return result;
  }
  const tables = tablesFromJson(input.json);
  const parsedTables = tables.length ? tables : tablesFromMarkdown(input.markdown);
  if (!parsedTables.length) {
    warnings.push({code:'mineru_excel_no_tables',message:'MinerU 未识别 Excel 表格，需要使用本地 SheetJS 回退或人工检查。'});
    return {kind:input.kind,title:input.filename,blocks:[],markdown:'',status:'failed',completeness:0,warnings};
  }
  const locator = createExcelLocator(input.originalBuffer, warnings);
  const blocks: ParsedBlock[] = [];
  const content: string[] = [`# ${input.filename.replace(/[\r\n#]+/g,' ').trim()}`];
  let recordCount = 0;
  for (const [tableIndex, table] of parsedTables.entries()) {
    const rows = parseRows(table.html);
    if (rows.length < 2) { warnings.push({code:'mineru_table_no_records',message:`工作表 ${table.sheet} 的表格没有有效数据行。`,sheetName:table.sheet}); continue; }
    const headers = rows[0].map((cell,i) => cell.text || `列${i+1}`);
    if (headers.every(h => /^列\d+$/.test(h))) { warnings.push({code:'mineru_table_header_missing',message:`工作表 ${table.sheet} 缺少表头，保留原始表格。`,sheetName:table.sheet}); }
    const section = `工作表：${table.sheet}`;
    content.push(`## ${section}`);
    blocks.push({type:'heading',text:section,level:2,sheetName:table.sheet,headingPath:[input.filename,section]});
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (!row.some(cell => cell.text || cell.images.length)) continue;
      recordCount++;
      const values = headers.map((_,idx) => row[idx]?.text ?? '');
      const sourceRow = locator?.find(table.sheet, headers, values) ?? null;
      if (sourceRow === null && locator) warnings.push({code:'mineru_row_unmatched',message:`工作表 ${table.sheet} 的第 ${rowIndex} 条记录无法精确定位 Excel 行号。`,sheetName:table.sheet});
      const recordId = `${hash}:${tableIndex}:${recordCount}`;
      const heading = sourceRow === null ? `记录 ${rowIndex}` : `第 ${sourceRow} 行`;
      const recordLines: string[] = [`### ${heading}`];
      for (let idx = 0; idx < Math.max(headers.length,row.length); idx++) {
        const label = headers[idx] || `列${idx+1}`;
        const cell = row[idx] ?? {text:'',images:[]};
        if (cell.text) recordLines.push(`- ${label}：${cell.text.replace(/\n/g,'；')}`);
        for (const source of cell.images) {
          const marker = await materializeImage(source,input.zip,input.images,hash,warnings,cache);
          recordLines.push(`- ${label}：${marker}`);
        }
      }
      const text = recordLines.join('\n');
      content.push(text);
      blocks.push({
        type:'paragraph',text,sheetName:table.sheet,
        headingPath:[input.filename,section,heading],
        metadata:{recordId,recordIndex:rowIndex,tableIndex,...(sourceRow !== null ? {sourceRow}: {})},
      });
    }
  }
  if (recordCount === 0) return {kind:input.kind,title:input.filename,blocks:[],markdown:'',status:'failed',completeness:0,warnings:[...warnings,{code:'mineru_excel_empty',message:'未识别到可索引的数据记录。'}]};
  return {kind:input.kind,title:input.filename,blocks,markdown:content.join('\n\n'),status:warnings.length?'partial':'complete',completeness:warnings.length?0.85:1,warnings};
}
