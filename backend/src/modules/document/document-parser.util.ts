import { BadRequestException } from '@nestjs/common';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

/**
 * 扫描件 PDF 兜底 OCR 所需的最小能力接口。
 *
 * 只要实现方带 `ocr(imageBuffer, mimeType)` 并返回含 `text` 的结果即可，
 * VisionProvider（mock / openai-compatible）天然满足该结构，
 * 因此控制器可以直接把 visionProvider 传入 extractDocumentText。
 */
export interface DocumentOcrDelegate {
  ocr(imageBuffer: Buffer, mimeType: string): Promise<{ text: string }>;
}

/** 渲染出的一页页图，供 OCR 按顺序识别 */
interface PdfPageImage {
  num: number;
  buffer: Buffer;
  mimeType: string;
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

/**
 * 提取文档文本。
 *
 * 仅 PDF 分支支持可选的 OCR 兜底：当 PDF 没有文本层（扫描件）时，
 * 会把页面渲染成图片并调用 `ocr` 识别，其他格式行为与原先完全一致。
 *
 * @param buffer 文档二进制内容
 * @param kind 文档类型
 * @param ocr 可选的 OCR 依赖（通常传 VisionProvider）；扫描件 PDF 缺少它时会抛出明确错误
 */
export async function extractDocumentText(
  buffer: Buffer,
  kind: SupportedDocumentKind,
  ocr?: DocumentOcrDelegate,
): Promise<string> {
  switch (kind) {
    case 'markdown':
    case 'text':
      return buffer.toString('utf-8');
    case 'pdf':
      return extractPdfText(buffer, ocr);
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
  const playwright = await dynamicImport<PlaywrightModule>('playwright');
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

/** 扫描件兜底 OCR：每页首次识别失败后再重试一次（共 2 次尝试） */
const OCR_MAX_ATTEMPTS_PER_PAGE = 2;

async function extractPdfText(
  buffer: Buffer,
  ocr?: DocumentOcrDelegate,
): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  let textResult;
  try {
    textResult = await parser.getText();
  } finally {
    await parser.destroy();
  }

  if (!isScannedPdf(textResult)) {
    return textResult.text;
  }
  // 扫描件（图片型 PDF）：页面渲染成图片 → Vision OCR → 合成 Markdown
  return ocrScannedPdf(buffer, textResult.total, ocr);
}

/**
 * 判断 PDF 是否为扫描件：逐页统计文本层，
 * 全文有效字符数或平均每页有效字符数低于阈值即判定为扫描件。
 */
function isScannedPdf(result: {
  pages: Array<{ num: number; text: string }>;
  text: string;
  total: number;
}): boolean {
  const totalPages = result.total || result.pages.length;
  if (totalPages === 0) {
    return false;
  }
  const totalChars = result.pages
    .map((page) => countSignificantChars(page.text))
    .reduce((sum, count) => sum + count, 0);
  if (totalChars < envPositiveNumber('PDF_SCANNED_MIN_TOTAL_CHARS', 50)) {
    return true;
  }
  return (
    totalChars / totalPages <
    envPositiveNumber('PDF_SCANNED_MIN_CHARS_PER_PAGE', 10)
  );
}

/** 有效字符数：忽略空白与控制符，避免靠换行缩进"凑字数"躲过扫描件判定 */
function countSignificantChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * 扫描件兜底 OCR 主流程：渲染页图 → 并发 OCR（并发 ≤ N、失败重试 1 次）→ 合成 Markdown。
 *
 * 未接入 OCR 依赖、页图渲染失败或 OCR 后整份文档仍无文字时，
 * 都会抛出带明确语义的错误，绝不静默产出空文档。
 */
async function ocrScannedPdf(
  buffer: Buffer,
  totalPages: number,
  ocr?: DocumentOcrDelegate,
): Promise<string> {
  if (!ocr || typeof ocr.ocr !== 'function') {
    throw new BadRequestException(
      'PDF has no text layer (looks like a scanned document) and needs OCR, ' +
        'but no vision provider is wired in. ' +
        'Configure VISION_PROVIDER (and the matching API key) to ingest scanned PDFs.',
    );
  }

  const maxPages = Math.min(
    Math.max(1, envPositiveNumber('PDF_OCR_MAX_PAGES', 20)),
    Math.max(1, totalPages || 1),
  );
  const concurrency = Math.max(1, envPositiveNumber('PDF_OCR_CONCURRENCY', 3));
  const pageImages = await renderPdfPageImages(buffer, maxPages);
  if (pageImages.length === 0) {
    throw new BadRequestException(
      `Scanned PDF fallback OCR failed: no page image could be rendered (total pages=${totalPages}).`,
    );
  }

  const pages = await mapWithConcurrency(
    pageImages,
    concurrency,
    async (image) => ({
      num: image.num,
      text: await ocrPageWithRetry(ocr, image),
    }),
  );
  pages.sort((a, b) => a.num - b.num);

  const recognizedChars = pages.reduce(
    (sum, page) => sum + countSignificantChars(page.text),
    0,
  );
  if (recognizedChars === 0) {
    throw new BadRequestException(
      `Scanned PDF fallback OCR finished but recognized no text in ${pages.length} page(s); ` +
        'refusing to ingest an empty document. Check the vision provider model/key.',
    );
  }

  return composeOcrMarkdown(pages);
}

/** 单页 OCR：失败自动重试 1 次，仍失败则抛出带页码语义的错误 */
async function ocrPageWithRetry(
  ocr: DocumentOcrDelegate,
  image: PdfPageImage,
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= OCR_MAX_ATTEMPTS_PER_PAGE; attempt += 1) {
    try {
      const result = await ocr.ocr(image.buffer, image.mimeType);
      return result?.text ?? '';
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw new BadRequestException(
    `Scanned PDF OCR failed on page ${image.num} after ${OCR_MAX_ATTEMPTS_PER_PAGE} attempts: ${lastError?.message}`,
  );
}

/** 合成扫描件 OCR 结果：固定顶部标题 + `## 第 N 页` 分页标题，供后续切片/检索按页定位 */
function composeOcrMarkdown(
  pages: Array<{ num: number; text: string }>,
): string {
  const sections = pages.map((page) =>
    [`## 第 ${page.num} 页`, '', page.text.trim() || '（本页未识别出文字）']
      .join('\n')
      .trim(),
  );
  return ['# Scanned PDF Document (OCR)', '', ...sections].join('\n\n').trim();
}

/** 简易并发池：最多 limit 个任务同时执行，结果顺序与输入一致 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/**
 * 渲染扫描件 PDF 页面为图片（最多 maxPages 页）。
 *
 * 优先使用系统 poppler 的 pdftoppm（安装成本低、渲染质量稳定），
 * 本机未安装时回退到内置的 pdfjs-dist + @napi-rs/canvas 渲染器。
 */
async function renderPdfPageImages(
  buffer: Buffer,
  maxPages: number,
): Promise<PdfPageImage[]> {
  if (hasPdftoppm()) {
    try {
      return await renderPdfPageImagesWithPdftoppm(buffer, maxPages);
    } catch (err) {
      // poppler 调用异常时降级到内置渲染器，不让扫描件 OCR 因环境问题直接失败
      console.warn(
        `pdftoppm rendering failed, falling back to pdfjs renderer: ${(err as Error).message}`,
      );
    }
  }
  return renderPdfPageImagesWithPdfjs(buffer, maxPages);
}

let pdftoppmAvailable: boolean | null = null;

/** 探测系统是否安装 poppler 的 pdftoppm（结果进程内缓存） */
function hasPdftoppm(): boolean {
  if (pdftoppmAvailable === null) {
    const probe = spawnSync('which', ['pdftoppm'], { encoding: 'utf-8' });
    pdftoppmAvailable = probe.status === 0 && Boolean(probe.stdout?.trim());
  }
  return pdftoppmAvailable;
}

/** pdftoppm 渲染：写临时 PDF → spawn pdftoppm → 收集页图 PNG */
async function renderPdfPageImagesWithPdftoppm(
  buffer: Buffer,
  maxPages: number,
): Promise<PdfPageImage[]> {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-ocr-'));
  const prefix = join(dir, 'page');
  const dpi = envPositiveNumber('PDF_OCR_DPI', 150);
  try {
    await writeFile(`${prefix}.pdf`, buffer);
    await new Promise<void>((resolveP, rejectP) => {
      const child = spawn('pdftoppm', [
        '-png',
        '-r',
        String(dpi),
        '-f',
        '1',
        '-l',
        String(maxPages),
        `${prefix}.pdf`,
        prefix,
      ]);
      child.on('error', rejectP);
      child.on('close', (code) => {
        if (code === 0) {
          resolveP();
        } else {
          rejectP(new Error(`pdftoppm exited with code ${code}`));
        }
      });
    });

    const files = await readdir(dir);
    const pageFiles = files
      .map((name) => /^page-(\d+)\.png$/.exec(name))
      .filter(Boolean)
      .sort((a, b) => Number(a![1]) - Number(b![1]));
    const pages: PdfPageImage[] = [];
    for (const match of pageFiles) {
      const num = Number(match![1]);
      if (num > maxPages) {
        continue;
      }
      pages.push({
        num,
        buffer: await readFile(join(dir, match![0])),
        mimeType: 'image/png',
      });
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ── 内置渲染器：pdfjs-dist（ESM）+ @napi-rs/canvas ── */

/**
 * 动态 import ESM-only 依赖的惯用法。
 *
 * tsc 以 CJS 输出时会把静态 `await import('x')` 降级成 require，
 * 导致 ESM-only 包（pdfjs-dist）加载失败，因此用 Function 构造器
 * 绕过编译期改写；playwright 动态渲染与 PDF 页面渲染共用此 helper。
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as <T>(specifier: string) => Promise<T>;

/**
 * pdfjs-dist legacy build 用到的最小 API 面。
 * 该包为 ESM-only 且版本迭代快，此处只声明渲染扫描页所需的方法。
 */
interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfjsDocument>;
    destroy(): Promise<void>;
  };
}

interface PdfjsDocument {
  numPages: number;
  getPage(num: number): Promise<PdfjsPage>;
}

interface PdfjsPage {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: Record<string, unknown>): { promise: Promise<unknown> };
  cleanup(): Promise<void>;
}

/** @napi-rs/canvas 用到的最小 API 面（画布创建 + DOM 对象 polyfill） */
interface NapiCanvasModule {
  createCanvas(width: number, height: number): NapiCanvas;
  DOMMatrix?: unknown;
  Path2D?: unknown;
  ImageData?: unknown;
}

interface NapiCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
  toBuffer(format: 'image/png'): Buffer;
}

async function loadNapiCanvas(): Promise<NapiCanvasModule> {
  try {
    return await dynamicImport<NapiCanvasModule>('@napi-rs/canvas');
  } catch (err) {
    throw new Error(
      `built-in PDF renderer unavailable (@napi-rs/canvas not installed): ${(err as Error).message}`,
    );
  }
}

/**
 * 加载 pdfjs-dist 并锁定 fake worker 版本。
 *
 * Node 环境下 pdfjs 使用 fake worker（主线程模拟），默认 workerSrc 是相对路径，
 * 在 pnpm 多副本（多个包依赖不同 pdfjs-dist 版本）时可能解析到旧版本，
 * 抛 "API version does not match the Worker version"；
 * 这里用 require.resolve 显式定位与本模块同版本的 worker 文件。
 */
async function loadPdfjs(): Promise<PdfjsModule> {
  try {
    // Node 环境需使用 legacy build（新版构建依赖较新的 V8 特性，如 Promise.try）
    const pdfjs = await dynamicImport<PdfjsModule>(
      'pdfjs-dist/legacy/build/pdf.mjs',
    );
    const moduleRequire = createRequire(__filename);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      moduleRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    return pdfjs;
  } catch (err) {
    throw new Error(
      `built-in PDF renderer unavailable (pdfjs-dist not installed): ${(err as Error).message}`,
    );
  }
}

/** pdfjs 渲染需要 DOM 标准对象，Node 下由 @napi-rs/canvas 补齐 */
function polyfillCanvasGlobals(canvasModule: NapiCanvasModule): void {
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['DOMMatrix', 'Path2D', 'ImageData'] as const) {
    const value = canvasModule[key];
    if (value && !globals[key]) {
      globals[key] = value;
    }
  }
}

/** pdfjs-dist + @napi-rs/canvas 渲染：无 poppler 环境下的兜底渲染器 */
async function renderPdfPageImagesWithPdfjs(
  buffer: Buffer,
  maxPages: number,
): Promise<PdfPageImage[]> {
  try {
    const canvasModule = await loadNapiCanvas();
    polyfillCanvasGlobals(canvasModule);
    const pdfjs = await loadPdfjs();
    // pdf-parse 内嵌的旧版 pdfjs 会把 fake worker 挂到 globalThis.pdfjsWorker，
    // 导致 pdfjs 版本错配（"API version does not match the Worker version"）。
    // 渲染期间临时替换为锁定版本的 worker，结束后恢复，互不干扰。
    const globals = globalThis as Record<string, unknown>;
    const savedFakeWorker = globals.pdfjsWorker;
    const workerModule = await dynamicImport<{ WorkerMessageHandler: unknown }>(
      pdfjs.GlobalWorkerOptions.workerSrc,
    );
    globals.pdfjsWorker = {
      WorkerMessageHandler: workerModule.WorkerMessageHandler,
    };

    const canvasFactory = {
      create(width: number, height: number) {
        const canvas = canvasModule.createCanvas(
          Math.ceil(width),
          Math.ceil(height),
        );
        return { canvas, context: canvas.getContext('2d') };
      },
      reset(
        canvasAndContext: { canvas: { width: number; height: number } },
        width: number,
        height: number,
      ) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
      },
      destroy(canvasAndContext: { canvas: unknown; context: unknown }) {
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
      },
    };

    const dpi = envPositiveNumber('PDF_OCR_DPI', 150);
    // getDocument 会 transfer 底层 buffer，传入拷贝避免调用方的 buffer 被 detach
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      canvasFactory,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    try {
      const pages: PdfPageImage[] = [];
      const pageCount = Math.min(doc.numPages, maxPages);
      for (let num = 1; num <= pageCount; num += 1) {
        const page = await doc.getPage(num);
        try {
          const viewport = page.getViewport({ scale: dpi / 72 });
          const { canvas, context } = canvasFactory.create(
            viewport.width,
            viewport.height,
          );
          await page.render({ canvas, canvasContext: context, viewport })
            .promise;
          pages.push({
            num,
            buffer: canvas.toBuffer('image/png'),
            mimeType: 'image/png',
          });
        } finally {
          await page.cleanup();
        }
      }
      return pages;
    } finally {
      await loadingTask.destroy();
      if (savedFakeWorker === undefined) {
        delete globals.pdfjsWorker;
      } else {
        globals.pdfjsWorker = savedFakeWorker;
      }
    }
  } catch (err) {
    throw new BadRequestException(
      `Scanned PDF page rendering failed (cannot produce page images for OCR): ${(err as Error).message}`,
    );
  }
}

/** 读取正整数环境变量，非法值回退默认值（阈值/并发等均可按需调参） */
function envPositiveNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
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
    const blocks = extractPptxTextBlocks(xml);
    if (blocks.length > 0) {
      const [title, ...body] = blocks;
      slides.push(
        [`## Slide ${index + 1}${title ? `：${title}` : ''}`, '', ...body]
          .join('\n')
          .trim(),
      );
    }
  }

  if (slides.length === 0) {
    return extractPrintableText(buffer, 'PowerPoint Document (fallback)');
  }
  return ['# PowerPoint Document', '', ...slides].join('\n\n').trim();
}

/**
 * 按段落而不是按 XML 文字节点展开：保留标题、项目符号和表格单元格的阅读顺序。
 * Office XML 异常时由调用方降级为二进制可打印文本，避免整份文档入库失败。
 */
function extractPptxTextBlocks(xml: string): string[] {
  const paragraphs = [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)]
    .map((paragraph) => {
      const text = [...paragraph[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlEntities(match[1]).trim())
        .filter(Boolean)
        .join('');
      const bullet = /<a:bu(?:Char|AutoNum|Blip)\b/.test(paragraph[1]);
      return text ? `${bullet ? '- ' : ''}${text}` : '';
    })
    .filter(Boolean);
  return paragraphs.length > 0
    ? paragraphs
    : [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlEntities(match[1]).trim())
        .filter(Boolean);
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
