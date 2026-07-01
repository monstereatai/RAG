import { BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export type SupportedDocumentKind =
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'xls'
  | 'pptx'
  | 'ppt'
  | 'csv'
  | 'json'
  | 'html'
  | 'image'
  | 'audio'
  | 'video';

export interface UrlExtractionResult {
  content: string;
  title?: string;
  description?: string;
  finalUrl: string;
  contentType: string;
  fetchedAt: string;
  snapshot: Buffer;
  extractionMode: 'static' | 'dynamic';
  renderError?: string;
}

interface PlaywrightModule {
  chromium: {
    launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
  };
}

interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options: {
      waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
      timeout: number;
    },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  url(): string;
}

export function detectDocumentKind(filename: string): SupportedDocumentKind {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lowerName.endsWith('.txt')) {
    return 'text';
  }
  if (lowerName.endsWith('.pdf')) {
    return 'pdf';
  }
  if (lowerName.endsWith('.docx')) {
    return 'docx';
  }
  if (lowerName.endsWith('.doc')) {
    return 'doc';
  }
  if (lowerName.endsWith('.xlsx')) {
    return 'xlsx';
  }
  if (lowerName.endsWith('.xls')) {
    return 'xls';
  }
  if (lowerName.endsWith('.pptx')) {
    return 'pptx';
  }
  if (lowerName.endsWith('.ppt')) {
    return 'ppt';
  }
  if (lowerName.endsWith('.csv')) {
    return 'csv';
  }
  if (lowerName.endsWith('.json')) {
    return 'json';
  }
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    return 'html';
  }
  if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(lowerName)) {
    return 'image';
  }
  if (/\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(lowerName)) {
    return 'audio';
  }
  if (/\.(mp4|mov|m4v|webm)$/i.test(lowerName)) {
    return 'video';
  }

  throw new BadRequestException(
    'only document, url, image, audio and video knowledge files are supported',
  );
}

export async function extractDocumentText(
  buffer: Buffer,
  kind: SupportedDocumentKind,
): Promise<string> {
  switch (kind) {
    case 'markdown':
    case 'text':
      return buffer.toString('utf-8');
    case 'pdf':
      return extractPdfText(buffer);
    case 'docx':
      return extractDocxText(buffer);
    case 'doc':
      return extractPrintableText(buffer, 'Legacy Word Document');
    case 'xlsx':
    case 'xls':
      return extractWorkbookText(buffer);
    case 'pptx':
      return extractPptxText(buffer);
    case 'ppt':
      return extractPrintableText(buffer, 'Legacy PowerPoint Document');
    case 'csv':
      return csvToMarkdown(buffer.toString('utf-8'));
    case 'json':
      return jsonToMarkdown(buffer.toString('utf-8'));
    case 'html':
      return htmlToText(buffer.toString('utf-8'));
    case 'image':
      return mediaFallbackMarkdown('Image Document', buffer);
    case 'audio':
      return mediaFallbackMarkdown('Audio Document', buffer);
    case 'video':
      return mediaFallbackMarkdown('Video Document', buffer);
  }
}

export async function extractUrlText(url: string): Promise<string> {
  const result = await extractUrlContent(url);
  return result.content;
}

export async function extractUrlContent(
  url: string,
): Promise<UrlExtractionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('valid url is required');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException('only http and https urls are supported');
  }

  const dynamicEnabled = process.env.URL_EXTRACT_DYNAMIC_ENABLED === 'true';
  if (dynamicEnabled) {
    try {
      const rendered = await renderDynamicUrl(parsed.toString());
      return buildHtmlUrlExtraction({
        html: rendered.html,
        sourceUrl: url,
        finalUrl: rendered.finalUrl,
        contentType: 'text/html; rendered=playwright',
        extractionMode: 'dynamic',
      });
    } catch (err) {
      if (process.env.URL_EXTRACT_DYNAMIC_REQUIRED === 'true') {
        throw new BadRequestException(
          `dynamic url rendering failed: ${(err as Error).message}`,
        );
      }
      const fallback = await extractStaticUrlContent(parsed, url);
      return {
        ...fallback,
        renderError: (err as Error).message,
      };
    }
  }

  return extractStaticUrlContent(parsed, url);
}

async function extractStaticUrlContent(
  parsed: URL,
  sourceUrl: string,
): Promise<UrlExtractionResult> {
  const response = await fetch(parsed, {
    headers: {
      accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8',
      'user-agent': 'RAG-KnowledgeBase/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new BadRequestException(
      `failed to fetch url: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 5 * 1024 * 1024) {
    throw new BadRequestException('url content is too large');
  }
  const text = await response.text();
  const snapshot = Buffer.from(text, 'utf-8');
  if (snapshot.length > 5 * 1024 * 1024) {
    throw new BadRequestException('url content is too large');
  }

  const finalUrl = response.url || parsed.toString();
  const fetchedAt = new Date().toISOString();
  if (contentType.includes('application/json')) {
    return {
      content: withUrlMetadata({
        body: jsonToMarkdown(text),
        sourceUrl,
        finalUrl,
        fetchedAt,
        contentType,
        extractionMode: 'static',
      }),
      finalUrl,
      contentType,
      fetchedAt,
      snapshot,
      extractionMode: 'static',
    };
  }
  if (contentType.includes('text/csv')) {
    return {
      content: withUrlMetadata({
        body: csvToMarkdown(text),
        sourceUrl,
        finalUrl,
        fetchedAt,
        contentType,
        extractionMode: 'static',
      }),
      finalUrl,
      contentType,
      fetchedAt,
      snapshot,
      extractionMode: 'static',
    };
  }
  if (contentType.includes('text/html')) {
    return buildHtmlUrlExtraction({
      html: text,
      sourceUrl,
      finalUrl,
      contentType,
      extractionMode: 'static',
    });
  }
  return {
    content: withUrlMetadata({
      body: text,
      sourceUrl,
      finalUrl,
      fetchedAt,
      contentType,
      extractionMode: 'static',
    }),
    finalUrl,
    contentType,
    fetchedAt,
    snapshot,
    extractionMode: 'static',
  };
}

function buildHtmlUrlExtraction(params: {
  html: string;
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  extractionMode: 'static' | 'dynamic';
}): UrlExtractionResult {
  const snapshot = Buffer.from(params.html, 'utf-8');
  if (snapshot.length > 5 * 1024 * 1024) {
    throw new BadRequestException('url content is too large');
  }
  const fetchedAt = new Date().toISOString();
  const extracted = htmlToText(params.html);
  const metadata = extractHtmlMetadata(params.html);
  return {
    content: withUrlMetadata({
      body: extracted,
      sourceUrl: params.sourceUrl,
      finalUrl: params.finalUrl,
      fetchedAt,
      contentType: params.contentType,
      title: metadata.title,
      description: metadata.description,
      extractionMode: params.extractionMode,
    }),
    title: metadata.title,
    description: metadata.description,
    finalUrl: params.finalUrl,
    contentType: params.contentType,
    fetchedAt,
    snapshot,
    extractionMode: params.extractionMode,
  };
}

async function renderDynamicUrl(url: string): Promise<{
  html: string;
  finalUrl: string;
}> {
  const dynamicImport = new Function(
    'specifier',
    'return import(specifier)',
  ) as (specifier: string) => Promise<PlaywrightModule>;
  const playwright = await dynamicImport('playwright');
  const browser = await playwright.chromium.launch({
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil:
        (process.env.URL_EXTRACT_DYNAMIC_WAIT_UNTIL as
          | 'load'
          | 'domcontentloaded'
          | 'networkidle') ?? 'networkidle',
      timeout: Number(process.env.URL_EXTRACT_DYNAMIC_TIMEOUT_MS ?? 15_000),
    });
    const settleMs = Number(process.env.URL_EXTRACT_DYNAMIC_SETTLE_MS ?? 500);
    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }
    return {
      html: await page.content(),
      finalUrl: page.url(),
    };
  } finally {
    await browser.close();
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractWorkbookText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    return [`## ${sheetName}`, '', csvToMarkdown(csv)].join('\n');
  });
  return ['# Spreadsheet Document', '', ...sections].join('\n\n').trim();
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const slides: string[] = [];
  for (const [index, filename] of slideFiles.entries()) {
    const xml = await zip.files[filename].async('text');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlEntities(match[1]).trim())
      .filter(Boolean);
    if (texts.length > 0) {
      slides.push(`## Slide ${index + 1}\n\n${texts.join('\n')}`);
    }
  }

  return ['# PowerPoint Document', '', ...slides].join('\n\n').trim();
}

function extractPrintableText(buffer: Buffer, title: string): string {
  const raw = buffer.toString('latin1');
  const text = [...raw]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13) return char;
      if (code >= 32 && code <= 126) return char;
      if (code >= 0x4e00 && code <= 0x9fff) return char;
      return ' ';
    })
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [
    `# ${title}`,
    '',
    text || 'Legacy binary file stored for retrieval metadata.',
  ]
    .join('\n')
    .trim();
}

function mediaFallbackMarkdown(title: string, buffer: Buffer): string {
  return [
    `# ${title}`,
    '',
    `Binary media file received (${buffer.length} bytes).`,
    'Detailed OCR / ASR / video understanding is handled by the ingestion pipeline when the configured provider is available.',
  ].join('\n');
}

function jsonToMarkdown(input: string): string {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new BadRequestException('invalid json document');
  }

  if (Array.isArray(value) && value.every(isPlainRecord)) {
    return recordsToMarkdownTable(value);
  }

  if (isPlainRecord(value)) {
    return objectToMarkdown(value);
  }

  return [
    '# JSON Document',
    '',
    '```json',
    JSON.stringify(value, null, 2),
    '```',
  ]
    .join('\n')
    .trim();
}

function csvToMarkdown(input: string): string {
  const rows = parseCsv(input)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));

  if (rows.length === 0) {
    return '';
  }

  const [header, ...body] = rows;
  const normalizedHeader = header.map(
    (cell, index) => cell || `Column ${index + 1}`,
  );
  const tableRows: string[][] =
    body.length > 0
      ? body
      : [Array.from({ length: normalizedHeader.length }, () => '')];
  return [
    '# CSV Document',
    '',
    markdownTable(normalizedHeader, tableRows),
  ].join('\n');
}

function htmlToText(input: string): string {
  const metadata = extractHtmlMetadata(input);
  const cleaned = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(nav|header|footer|aside|form|button)[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    );
  const main =
    cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    cleaned;

  const body = decodeHtmlEntities(
    main
      .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );

  const cleanTitle = metadata.title;
  return [cleanTitle ? `# ${cleanTitle}` : '', body]
    .filter(Boolean)
    .join('\n\n');
}

function extractHtmlMetadata(input: string): {
  title?: string;
  description?: string;
} {
  const title =
    input.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    input.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    '';
  const description =
    input.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    input.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    '';
  return {
    title: cleanInlineHtml(title),
    description: cleanInlineHtml(description),
  };
}

function withUrlMetadata(params: {
  body: string;
  sourceUrl: string;
  finalUrl: string;
  fetchedAt: string;
  contentType: string;
  extractionMode: 'static' | 'dynamic';
  title?: string;
  description?: string;
}): string {
  return [
    params.title ? `# ${params.title}` : '',
    params.description ? `> ${params.description}` : '',
    '## Source',
    '',
    `- URL: ${params.sourceUrl}`,
    `- Final URL: ${params.finalUrl}`,
    `- Fetched At: ${params.fetchedAt}`,
    `- Content-Type: ${params.contentType || 'unknown'}`,
    `- Extraction Mode: ${params.extractionMode}`,
    '',
    params.body,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function cleanInlineHtml(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function objectToMarkdown(record: Record<string, unknown>): string {
  return [
    '# JSON Document',
    '',
    ...Object.entries(record).map(([key, value]) => {
      const rendered =
        typeof value === 'object' && value !== null
          ? `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
          : ` ${stringifyCell(value)}`;
      return `## ${key}\n${rendered}`;
    }),
  ].join('\n\n');
}

function recordsToMarkdownTable(records: Record<string, unknown>[]): string {
  const headers = Array.from(
    records.reduce((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const rows = records.map((record) =>
    headers.map((header) => stringifyCell(record[header])),
  );
  return ['# JSON Document', '', markdownTable(headers, rows)].join('\n');
}

function markdownTable(headers: string[], rows: string[][]): string {
  const normalizedRows = rows.map((row) =>
    headers.map((_, index) => escapeMarkdownCell(row[index] ?? '')),
  );
  return [
    `| ${headers.map(escapeMarkdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...normalizedRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return value.description ?? '';
  }
  return '';
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeXmlEntities(input: string): string {
  return decodeHtmlEntities(input).replace(/&apos;/g, "'");
}
