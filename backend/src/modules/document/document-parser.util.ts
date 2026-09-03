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

/* ── 内嵌图片提取：对象存储 / alt 描述的注入接口 ──
 *
 * 与 DocumentOcrDelegate 同一风格：解析器只依赖最小能力接口，
 * Nest 侧直接把 ObjectStorageProvider / VisionProvider 传入（方法签名天然对齐）。
 */

/**
 * 内嵌图片上传所需的对象存储最小能力接口。
 * ObjectStorageProvider.putObject 天然满足该结构。
 */
export interface DocumentImageStorageDelegate {
  putObject(params: {
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<{ key: string; url: string }>;
}

/**
 * 内嵌图片 alt 描述所需的最小能力接口。
 * VisionProvider.describeImage 天然满足该结构（返回值只需含 description）。
 */
export interface DocumentImageAltDelegate {
  describeImage(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<{ description: string }>;
}

/** 内嵌图片提取的注入参数（由控制器组装后传入 extractDocumentText） */
export interface DocumentImageExtractionOptions {
  /** 对象存储上传委托；缺省或调用异常时整个提取功能静默跳过，不影响主入库链路 */
  storage: DocumentImageStorageDelegate;
  /** 可选的图片描述委托（通常传 VisionProvider）；未提供时 alt 直接使用文件名 */
  vision?: DocumentImageAltDelegate;
  /** 对象存储路径中的文档标识；缺省用时间戳占位 */
  docId?: string;
}

/** 提取到的内嵌图片（已归属到页/slide，等待上传） */
interface EmbeddedImageAsset {
  /** 归属标签，同时用于对象存储 key（如 page-2 / slide-3 / misc） */
  placement: string;
  /** 归属序号：PDF 页码或 PPTX slide 序号；0 表示无法归属（统一进「文稿插图」） */
  position: number;
  buffer: Buffer;
  mimeType: string;
  /** 兜底文件名（未配置 vision 或 alt 生成失败时用作 alt） */
  filename: string;
}

/** 上传完成并生成 alt 后的内嵌图片，可直接渲染为 `![alt](url)` */
interface UploadedEmbeddedImage {
  position: number;
  url: string;
  alt: string;
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
 * PDF / PPTX 分支额外支持可选的内嵌图片提取（`images`）：把文档里的内嵌图
 * 上传到对象存储并在 Markdown 中插入 `![alt](url)`；扫描件走 OCR 路径时
 * 不再重复提取（OCR 页图是渲染产物，不是内嵌图）。
 *
 * @param buffer 文档二进制内容
 * @param kind 文档类型
 * @param ocr 可选的 OCR 依赖（通常传 VisionProvider）；扫描件 PDF 缺少它时会抛出明确错误
 * @param images 可选的内嵌图片提取参数；未提供或对象存储异常时保持纯文本提取
 */
export async function extractDocumentText(
  buffer: Buffer,
  kind: SupportedDocumentKind,
  ocr?: DocumentOcrDelegate,
  images?: DocumentImageExtractionOptions,
): Promise<string> {
  switch (kind) {
    case 'markdown':
    case 'text':
      return buffer.toString('utf-8');
    case 'pdf':
      return extractPdfText(buffer, ocr, images);
    case 'docx':
      return extractDocxText(buffer);
    case 'doc':
      return extractPrintableText(buffer, 'Legacy Word Document');
    case 'xlsx':
    case 'xls':
      return extractWorkbookText(buffer);
    case 'pptx':
      return extractPptxText(buffer, images);
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
  images?: DocumentImageExtractionOptions,
): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  let textResult;
  try {
    textResult = await parser.getText();
  } finally {
    await parser.destroy();
  }

  if (isScannedPdf(textResult)) {
    // 扫描件走 OCR 兜底：页图是渲染产物而非内嵌图，与内嵌图片提取互斥，不再重复提取
    return ocrScannedPdf(buffer, textResult.total, ocr);
  }

  const text = textResult.text;
  if (!images || !isImageExtractionEnabled() || !hasImageStorage(images)) {
    return text;
  }
  try {
    return await composeTextPdfWithImages(buffer, textResult, images);
  } catch (err) {
    // 内嵌图片提取属于增强能力：对象存储不可用等任何异常都静默降级为纯文本，绝不阻塞入库
    console.warn(
      `PDF embedded image extraction skipped, falling back to plain text: ${
        (err as Error).message
      }`,
    );
    return text;
  }
}

/* ── PDF 内嵌图片提取 ──
 *
 * 用 pdfjs-dist 逐页遍历 operator list 里的 paintImageXObject 调用（天然带页码归属），
 * 字节来源两级策略：
 *   1. 原始字节直传：DCTDecode（JPEG）且能在原文件中按对象号定位到流时，直接取原始 JPEG；
 *   2. 像素回退：pdfjs 已解码的位图（FlateDecode 等的统一产物）用 @napi-rs/canvas 重编码为 PNG；
 * 两者都不可用（JBIG2/JPX 等异构编码解码失败）时计 skipped 并跳过，绝不中断解析。
 */

/** pdfjs 解码产物的图片种类（ImageKind） */
const PDFJS_IMAGE_KIND = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3,
} as const;

/** 等待 pdfjs 图片对象解码完成的兜底超时（getOperatorList 后 objs 可能尚未就绪） */
const PDFJS_IMAGE_RESOLVE_TIMEOUT_MS = 2_000;

/** alt 批量生成的并发上限（视觉模型调用温和节流） */
const IMAGE_ALT_CONCURRENCY = 2;

/**
 * 有文本层 PDF 的内嵌图合成：提取 → 上传 → 按「## 第 N 页」分页重组 Markdown。
 * 图片紧跟对应页标题之后；页面无文字且无图片时跳过该页。
 */
async function composeTextPdfWithImages(
  buffer: Buffer,
  textResult: {
    text: string;
    pages: Array<{ num: number; text: string }>;
    total: number;
  },
  images: DocumentImageExtractionOptions,
): Promise<string> {
  // 页数上限跟随扫描件渲染页数（PDF_OCR_MAX_PAGES），可用 PDF_IMAGE_MAX_PAGES 单独覆盖
  const maxPages = Math.min(
    Math.max(
      1,
      envPositiveNumber(
        'PDF_IMAGE_MAX_PAGES',
        envPositiveNumber('PDF_OCR_MAX_PAGES', 20),
      ),
    ),
    Math.max(1, textResult.total || textResult.pages.length || 1),
  );
  const { assets, skipped } = await extractPdfEmbeddedImages(buffer, maxPages);
  if (skipped > 0) {
    console.warn(
      `PDF embedded image extraction skipped ${skipped} unsupported image object(s) ` +
        '(JBIG2/JPX/mask, decode failure or count limit).',
    );
  }
  if (assets.length === 0) {
    return textResult.text;
  }
  const uploaded = await uploadEmbeddedImages(assets, images);
  return composePdfMarkdownWithPages(
    textResult,
    groupImagesByPosition(uploaded),
  );
}

/** 有文本层 PDF 的 Markdown：插入 `## 第 N 页` 分页标题，图片紧跟标题之后 */
function composePdfMarkdownWithPages(
  textResult: { text: string; pages: Array<{ num: number; text: string }> },
  imagesByPage: Map<number, UploadedEmbeddedImage[]>,
): string {
  const sections: string[] = [];
  for (const page of textResult.pages) {
    const imageLines = (imagesByPage.get(page.num) ?? []).map(
      (image) => `![${image.alt}](${image.url})`,
    );
    const pageText = page.text.trim();
    if (!pageText && imageLines.length === 0) {
      continue;
    }
    sections.push(
      [
        `## 第 ${page.num} 页`,
        '',
        ...imageLines,
        ...(pageText ? ['', pageText] : []),
      ]
        .join('\n')
        .trim(),
    );
  }
  if (sections.length === 0) {
    return textResult.text;
  }
  return ['# PDF Document', '', ...sections].join('\n\n').trim();
}

/**
 * 提取 PDF 内嵌图片：逐页遍历 paintImageXObject 算子并解析图片字节。
 *
 * 同一 XObject 被多页复用时只提取一次；达到 PDF_IMAGE_MAX_COUNT 上限后停止收集。
 */
async function extractPdfEmbeddedImages(
  buffer: Buffer,
  maxPages: number,
): Promise<{ assets: EmbeddedImageAsset[]; skipped: number }> {
  const canvasModule = await loadNapiCanvas();
  polyfillCanvasGlobals(canvasModule);
  const pdfjs = await loadPdfjs();
  const restoreFakeWorker = await lockPdfjsFakeWorker(pdfjs);

  const maxCount = Math.max(1, envPositiveNumber('PDF_IMAGE_MAX_COUNT', 30));
  const assets: EmbeddedImageAsset[] = [];
  let skipped = 0;
  try {
    // getDocument 会 transfer 底层 buffer，传入拷贝避免调用方的 buffer 被 detach
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    try {
      const seenRefs = new Set<string>();
      const seqByPage = new Map<number, number>();
      for (let num = 1; num <= Math.min(doc.numPages, maxPages); num += 1) {
        if (assets.length >= maxCount) {
          break;
        }
        const page = await doc.getPage(num);
        try {
          const ops = await page.getOperatorList();
          const seenNames = new Set<string>();
          for (let i = 0; i < ops.fnArray.length; i += 1) {
            const fn = ops.fnArray[i];
            if (
              fn !== pdfjs.OPS.paintImageXObject &&
              fn !== pdfjs.OPS.paintImageXObjectRepeat
            ) {
              continue;
            }
            const objId = ops.argsArray[i]?.[0];
            if (typeof objId !== 'string' || seenNames.has(objId)) {
              continue;
            }
            seenNames.add(objId);
            if (assets.length >= maxCount) {
              skipped += 1;
              continue;
            }
            const imageData = await resolvePdfjsImageObject(page, objId);
            if (!imageData) {
              skipped += 1;
              continue;
            }
            const refKey =
              typeof imageData.ref === 'string' ? imageData.ref : '';
            if (refKey && seenRefs.has(refKey)) {
              continue; // 同一 XObject 被多页复用时只提取一次
            }
            const seq = (seqByPage.get(num) ?? 0) + 1;
            const asset = buildPdfImageAsset(
              canvasModule,
              buffer,
              imageData,
              num,
              `page-${num}-image-${seq}`,
            );
            if (!asset) {
              skipped += 1;
              continue;
            }
            seqByPage.set(num, seq);
            if (refKey) {
              seenRefs.add(refKey);
            }
            assets.push(asset);
          }
        } finally {
          await page.cleanup();
        }
      }
    } finally {
      await loadingTask.destroy();
    }
  } finally {
    restoreFakeWorker();
  }
  return { assets, skipped };
}

/** 组装单张 PDF 内嵌图：优先 JPEG 原始字节直传，失败回退像素重编码 PNG */
function buildPdfImageAsset(
  canvasModule: NapiCanvasModule,
  raw: Buffer,
  imageData: PdfjsImageData,
  pageNum: number,
  filenameBase: string,
): EmbeddedImageAsset | null {
  const refNum = parsePdfjsRefNumber(imageData.ref);
  if (refNum !== null) {
    const jpeg = extractRawJpegStream(raw, refNum);
    if (jpeg) {
      return {
        placement: `page-${pageNum}`,
        position: pageNum,
        buffer: jpeg,
        mimeType: 'image/jpeg',
        filename: `${filenameBase}.jpg`,
      };
    }
  }
  const png = encodePdfjsImageToPng(canvasModule, imageData);
  if (!png) {
    return null;
  }
  return {
    placement: `page-${pageNum}`,
    position: pageNum,
    buffer: png,
    mimeType: 'image/png',
    filename: `${filenameBase}.png`,
  };
}

/** pdfjs 的图片 ref：新版是 "对象号R" 字符串（如 "5R"），旧版是 {num, gen}；解析出对象号 */
function parsePdfjsRefNumber(ref: unknown): number | null {
  if (typeof ref === 'string') {
    const match = /^(\d+)R$/.exec(ref);
    if (!match) {
      return null;
    }
    const num = Number(match[1]);
    return Number.isInteger(num) && num > 0 ? num : null;
  }
  if (ref && typeof ref === 'object' && 'num' in ref) {
    const num = Number(ref.num);
    return Number.isInteger(num) && num > 0 ? num : null;
  }
  return null;
}

/**
 * 从原始 PDF 字节中定位 DCTDecode（JPEG）图片对象流，直接返回原始 JPEG 字节。
 *
 * 仅处理「普通 xref + 直接 /Length」的常见布局；对象流压缩、间接 /Length、
 * 字节完整性校验失败等任何不匹配都返回 null，由调用方回退到像素重编码路径。
 */
function extractRawJpegStream(raw: Buffer, objNum: number): Buffer | null {
  if (!Number.isInteger(objNum) || objNum <= 0) {
    return null;
  }
  const head = Buffer.from(`${objNum} 0 obj`, 'latin1');
  const start = raw.indexOf(head);
  if (start < 0) {
    return null;
  }
  const streamKeyword = raw.indexOf('stream', start + head.length);
  if (streamKeyword < 0) {
    return null;
  }
  const dict = raw.slice(start, streamKeyword).toString('latin1');
  if (
    !/\/Subtype\s*\/Image/.test(dict) ||
    /\/ImageMask\s+true/.test(dict) ||
    !/\/DCTDecode/.test(dict)
  ) {
    return null;
  }
  if (/\/Length\s+\d+\s+\d+\s+R/.test(dict)) {
    return null; // 间接 /Length：放弃原始提取，走像素回退
  }
  let dataStart = streamKeyword + 'stream'.length;
  // stream 关键字后必须紧跟 EOL（\r\n | \n | \r）
  if (raw[dataStart] === 0x0d) {
    dataStart += 1;
  }
  if (raw[dataStart] === 0x0a) {
    dataStart += 1;
  }
  const lengthMatch = /\/Length\s+(\d+)/.exec(dict);
  let stream: Buffer;
  if (lengthMatch) {
    stream = raw.slice(dataStart, dataStart + Number(lengthMatch[1]));
  } else {
    const end = raw.indexOf('endstream', dataStart);
    if (end < 0) {
      return null;
    }
    stream = raw.slice(dataStart, end);
  }
  // JPEG 完整性校验：SOI 开头、EOI 结尾（末尾允许少量填充空白）
  if (stream.length < 4 || stream[0] !== 0xff || stream[1] !== 0xd8) {
    return null;
  }
  let end = stream.length;
  while (
    end > 2 &&
    (stream[end - 1] === 0x0a ||
      stream[end - 1] === 0x0d ||
      stream[end - 1] === 0x20)
  ) {
    end -= 1;
  }
  if (stream[end - 2] === 0xff && stream[end - 1] === 0xd9) {
    return stream.subarray(0, end);
  }
  return null;
}

/** 等待 pdfjs 解码图片对象完成；超时或仓库不存在时返回 null（调用方计 skipped） */
function resolvePdfjsImageObject(
  page: PdfjsPage,
  objId: string,
): Promise<PdfjsImageData | null> {
  const store = objId.startsWith('g_') ? page.commonObjs : page.objs;
  if (!store) {
    return Promise.resolve(null);
  }
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (data: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise((data as PdfjsImageData) ?? null);
    };
    const timer = setTimeout(
      () => finish(null),
      PDFJS_IMAGE_RESOLVE_TIMEOUT_MS,
    );
    try {
      store.get(objId, finish);
      if (store.has?.(objId)) {
        finish(store.get(objId));
      }
    } catch {
      finish(null);
    }
  });
}

/**
 * pdfjs 解码产物 → PNG 字节：支持 GRAYSCALE_1BPP / RGB_24BPP / RGBA_32BPP，
 * 其余情况（异构编码未解码、数据不完整）返回 null 由调用方计 skipped。
 */
function encodePdfjsImageToPng(
  canvasModule: NapiCanvasModule,
  image: PdfjsImageData,
): Buffer | null {
  const { width, height, kind, data } = image;
  if (
    !width ||
    !height ||
    !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)
  ) {
    return null;
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (kind === PDFJS_IMAGE_KIND.RGB_24BPP) {
    if (data.length < width * height * 3) {
      return null;
    }
    for (let i = 0, j = 0; i < width * height; i += 1, j += 4) {
      rgba[j] = data[i * 3];
      rgba[j + 1] = data[i * 3 + 1];
      rgba[j + 2] = data[i * 3 + 2];
      rgba[j + 3] = 255;
    }
  } else if (kind === PDFJS_IMAGE_KIND.RGBA_32BPP) {
    if (data.length < width * height * 4) {
      return null;
    }
    rgba.set(data.subarray(0, width * height * 4));
  } else if (kind === PDFJS_IMAGE_KIND.GRAYSCALE_1BPP) {
    const rowBytes = Math.ceil(width / 8);
    if (data.length < rowBytes * height) {
      return null;
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = bit ? 255 : 0; // pdfjs 惯例：1 = 白
        const j = (y * width + x) * 4;
        rgba[j] = value;
        rgba[j + 1] = value;
        rgba[j + 2] = value;
        rgba[j + 3] = 255;
      }
    }
  } else {
    return null;
  }
  const ImageDataCtor = (
    globalThis as {
      ImageData?: new (
        data: Uint8ClampedArray,
        width: number,
        height: number,
      ) => object;
    }
  ).ImageData;
  if (!ImageDataCtor) {
    return null;
  }
  const canvas = canvasModule.createCanvas(width, height);
  const context = canvas.getContext('2d') as {
    putImageData(imageData: object, dx: number, dy: number): void;
  };
  context.putImageData(new ImageDataCtor(rgba, width, height), 0, 0);
  return canvas.toBuffer('image/png');
}

/* ── 内嵌图片：上传与 alt 生成（PDF / PPTX 共用） ── */

/** 图片扩展名 → MIME（PPTX ppt/media 按扩展名识别） */
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** MIME → 对象存储 key 的扩展名 */
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

/**
 * 通用上传流程：逐张写入对象存储（key 形如 documents/{docId}/images/page-2-1.png），
 * 再批量生成 alt（并发 ≤2、总数上限 DOCUMENT_IMAGE_ALT_MAX_COUNT 张）。
 *
 * 任何上传异常向上抛出，由调用方整体降级为纯文本——保证不影响主入库链路。
 */
async function uploadEmbeddedImages(
  assets: EmbeddedImageAsset[],
  images: DocumentImageExtractionOptions,
): Promise<UploadedEmbeddedImage[]> {
  const folder = images.docId?.trim() || `doc-${Date.now()}`;
  const counters = new Map<string, number>();
  const uploaded: UploadedEmbeddedImage[] = [];
  for (const asset of assets) {
    const seq = (counters.get(asset.placement) ?? 0) + 1;
    counters.set(asset.placement, seq);
    const extension = IMAGE_EXTENSION_BY_MIME[asset.mimeType] ?? 'bin';
    const stored = await images.storage.putObject({
      key: `documents/${folder}/images/${asset.placement}-${seq}.${extension}`,
      body: asset.buffer,
      contentType: asset.mimeType,
    });
    uploaded.push({ position: asset.position, url: stored.url, alt: '' });
  }

  // alt 批量生成：并发 ≤2、总数有上限，失败或未配置 vision 时回退为文件名，绝不阻塞入库
  const altLimit = Math.max(
    0,
    envPositiveNumber('DOCUMENT_IMAGE_ALT_MAX_COUNT', 10),
  );
  const alts = await mapWithConcurrency(
    assets.slice(0, altLimit),
    IMAGE_ALT_CONCURRENCY,
    (asset) => describeEmbeddedImage(asset, images),
  );
  return uploaded.map((image, index) => ({
    ...image,
    alt:
      index < alts.length
        ? alts[index]
        : toMarkdownAltText('', assets[index].filename),
  }));
}

/** 单张图片的 alt：vision 描述失败时回退文件名 */
async function describeEmbeddedImage(
  asset: EmbeddedImageAsset,
  images: DocumentImageExtractionOptions,
): Promise<string> {
  const fallback = toMarkdownAltText('', asset.filename);
  const vision = images.vision;
  if (!vision || typeof vision.describeImage !== 'function') {
    return fallback;
  }
  try {
    const result = await vision.describeImage(asset.buffer, asset.mimeType);
    return toMarkdownAltText(result?.description, fallback);
  } catch (err) {
    console.warn(
      `embedded image alt generation failed for ${asset.filename}: ${
        (err as Error).message
      }`,
    );
    return fallback;
  }
}

/** 清洗 alt 文本：剔除会破坏 `![alt](url)` 语法的字符，空值回退文件名 */
function toMarkdownAltText(
  raw: string | undefined | null,
  fallback: string,
): string {
  const cleaned = (raw ?? '')
    .replace(/[[\]]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

/** 图片按归属序号（页码/slide 号）分组，组内保持上传顺序 */
function groupImagesByPosition(
  uploaded: UploadedEmbeddedImage[],
): Map<number, UploadedEmbeddedImage[]> {
  const grouped = new Map<number, UploadedEmbeddedImage[]>();
  for (const image of uploaded) {
    const list = grouped.get(image.position) ?? [];
    list.push(image);
    grouped.set(image.position, list);
  }
  return grouped;
}

/** 功能开关：DOCUMENT_EXTRACT_IMAGES（默认开启；显式 false/0/off/no 关闭） */
function isImageExtractionEnabled(): boolean {
  const raw = (process.env.DOCUMENT_EXTRACT_IMAGES ?? '').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(raw);
}

/** 内嵌图片提取参数是否带有可用的对象存储委托 */
function hasImageStorage(
  images?: DocumentImageExtractionOptions,
): images is DocumentImageExtractionOptions {
  return Boolean(
    images && images.storage && typeof images.storage.putObject === 'function',
  );
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
 * 该包为 ESM-only 且版本迭代快，此处只声明渲染扫描页、
 * 遍历内嵌图片算子（getOperatorList/objs）所需的方法与常量。
 */
interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  OPS: Record<string, number>;
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
  /** 页面算子表：内嵌图片经 paintImageXObject 等算子引用，args 里带 objId */
  getOperatorList(): Promise<{
    fnArray: number[];
    argsArray: unknown[][];
  }>;
  /** 页面级对象仓库：图片解码结果按 objId 存放，getOperatorList 后可能尚未就绪 */
  objs: PdfjsObjects;
  commonObjs?: PdfjsObjects;
}

/** pdfjs 对象仓库（页内 objs / 文档级 commonObjs 的最小能力面） */
interface PdfjsObjects {
  get(objId: string, callback?: (data: unknown) => void): unknown;
  has?(objId: string): boolean;
}

/** pdfjs 解码后的图片对象：kind 见 PDFJS_IMAGE_KIND，ref 为 PDF 对象引用 */
interface PdfjsImageData {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  ref?: unknown;
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

/**
 * 渲染 / 算子遍历期间把 globalThis.pdfjsWorker 临时替换为与当前 pdfjs 同版本的
 * fake worker，返回恢复函数。
 *
 * pdf-parse 内嵌的旧版 pdfjs 会把 fake worker 挂到 globalThis.pdfjsWorker，
 * 导致 pdfjs 版本错配（"API version does not match the Worker version"）；
 * 页面渲染与内嵌图片提取共用此保护。
 */
async function lockPdfjsFakeWorker(pdfjs: PdfjsModule): Promise<() => void> {
  const globals = globalThis as Record<string, unknown>;
  const savedFakeWorker = globals.pdfjsWorker;
  const workerModule = await dynamicImport<{ WorkerMessageHandler: unknown }>(
    pdfjs.GlobalWorkerOptions.workerSrc,
  );
  globals.pdfjsWorker = {
    WorkerMessageHandler: workerModule.WorkerMessageHandler,
  };
  return () => {
    if (savedFakeWorker === undefined) {
      delete globals.pdfjsWorker;
    } else {
      globals.pdfjsWorker = savedFakeWorker;
    }
  };
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
    // pdf-parse 内嵌旧版 pdfjs 会污染 globalThis.pdfjsWorker，渲染期间临时替换为锁定版本
    const restoreFakeWorker = await lockPdfjsFakeWorker(pdfjs);

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
      restoreFakeWorker();
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

async function extractPptxText(
  buffer: Buffer,
  images?: DocumentImageExtractionOptions,
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // 内嵌图片提取：失败静默降级为纯文本，保证不影响主入库链路
  let imagesBySlide: Map<number, UploadedEmbeddedImage[]> | null = null;
  let miscImages: UploadedEmbeddedImage[] = [];
  if (images && isImageExtractionEnabled() && hasImageStorage(images)) {
    try {
      const assets = await extractPptxImageAssets(zip, slideFiles);
      const all = [
        ...[...assets.bySlide.values()].flat(),
        ...assets.unattributed,
      ];
      if (all.length > 0) {
        const uploaded = await uploadEmbeddedImages(all, images);
        imagesBySlide = groupImagesByPosition(
          uploaded.filter((image) => image.position > 0),
        );
        miscImages = uploaded.filter((image) => image.position === 0);
      }
    } catch (err) {
      console.warn(
        `PPTX embedded image extraction skipped, falling back to plain text: ${
          (err as Error).message
        }`,
      );
    }
  }

  const slides: string[] = [];
  for (const [index, filename] of slideFiles.entries()) {
    const xml = await zip.files[filename].async('text');
    const blocks = extractPptxTextBlocks(xml);
    // 图片归属按 slide 文件名里的真实序号（slideN.xml），与展示序号在合规文件中一致
    const slideNum = Number(
      /slide(\d+)\.xml$/.exec(filename)?.[1] ?? index + 1,
    );
    const imageLines = (imagesBySlide?.get(slideNum) ?? []).map(
      (image) => `![${image.alt}](${image.url})`,
    );
    if (blocks.length === 0 && imageLines.length === 0) {
      continue;
    }
    const [title, ...body] = blocks;
    const lines = [
      `## Slide ${index + 1}${title ? `：${title}` : ''}`,
      '',
      ...body,
    ];
    // 插图放在对应 slide 段落之后
    if (imageLines.length > 0) {
      if (body.length > 0) {
        lines.push('');
      }
      lines.push(...imageLines);
    }
    slides.push(lines.join('\n').trim());
  }

  // 归属不明的插图统一收进「文稿插图」段
  if (miscImages.length > 0) {
    slides.push(
      [
        '## 文稿插图',
        '',
        ...miscImages.map((image) => `![${image.alt}](${image.url})`),
      ]
        .join('\n')
        .trim(),
    );
  }

  if (slides.length === 0) {
    return extractPrintableText(buffer, 'PowerPoint Document (fallback)');
  }
  return ['# PowerPoint Document', '', ...slides].join('\n\n').trim();
}

/** PPTX 内嵌图提取结果：按 slide 归属 + 无法归属的统一段 */
interface PptxImageAssets {
  bySlide: Map<number, EmbeddedImageAsset[]>;
  unattributed: EmbeddedImageAsset[];
}

/** 单个 PPTX 允许上传的内嵌图总数上限（恶意超大 media 目录的限流保护） */
const PPTX_IMAGE_MAX_COUNT_DEFAULT = 30;

/**
 * 提取 PPTX 内嵌图：读 ppt/media/*，并通过 slideN.xml.rels 把图归属到对应 slide。
 *
 * 归属方式：slide XML 里按 blip 引用（r:embed）出现顺序，经 rels 的 rId → media
 * 映射定位媒体文件；同一媒体被多页复用时只归属首次出现的 slide；
 * rels 解析不了 / 未被引用的媒体统一放进 unattributed（渲染为「文稿插图」段）。
 * EMF/WMF/TIFF 等无法在 Markdown 渲染的媒体类型直接忽略。
 */
async function extractPptxImageAssets(
  zip: JSZip,
  slideFiles: string[],
): Promise<PptxImageAssets> {
  const result: PptxImageAssets = { bySlide: new Map(), unattributed: [] };
  const mediaByPath = new Map<string, { filename: string; mimeType: string }>();
  for (const name of Object.keys(zip.files)) {
    const match = /^ppt\/media\/([^/]+)$/.exec(name);
    const mimeType = match
      ? IMAGE_MIME_BY_EXTENSION[extensionOf(match[1])]
      : undefined;
    if (!match || zip.files[name].dir || !mimeType) {
      continue;
    }
    mediaByPath.set(name, { filename: match[1], mimeType });
  }
  if (mediaByPath.size === 0) {
    return result;
  }

  const maxCount = Math.max(
    1,
    envPositiveNumber('DOCUMENT_IMAGE_MAX_COUNT', PPTX_IMAGE_MAX_COUNT_DEFAULT),
  );
  let collected = 0;
  let truncated = 0;

  // 1. slide → rels → blip 引用顺序归属
  const attributed = new Set<string>();
  for (const filename of slideFiles) {
    const slideNum = Number(/slide(\d+)\.xml$/.exec(filename)?.[1] ?? 0);
    if (!slideNum) {
      continue;
    }
    const relsEntry = zip.files[`ppt/slides/_rels/slide${slideNum}.xml.rels`];
    if (!relsEntry) {
      continue; // 没有 rels 的 slide 引用不到媒体，其余媒体留给「文稿插图」
    }
    let slideXml: string;
    let relsXml: string;
    try {
      slideXml = await zip.files[filename].async('text');
      relsXml = await relsEntry.async('text');
    } catch {
      continue; // 读取失败 → 该 slide 的媒体归属不了，统一进「文稿插图」
    }
    const targetByRid = parsePptxImageRelTargets(relsXml);
    for (const match of slideXml.matchAll(/[\w.-]+:embed="([^"]+)"/g)) {
      const mediaPath = targetByRid.get(match[1]);
      if (
        !mediaPath ||
        !mediaByPath.has(mediaPath) ||
        attributed.has(mediaPath)
      ) {
        continue;
      }
      attributed.add(mediaPath);
      if (collected >= maxCount) {
        truncated += 1;
        continue;
      }
      const media = mediaByPath.get(mediaPath)!;
      const buffer = await zip.files[mediaPath].async('nodebuffer');
      if (!buffer || buffer.length === 0) {
        continue;
      }
      const list = result.bySlide.get(slideNum) ?? [];
      list.push({
        placement: `slide-${slideNum}`,
        position: slideNum,
        buffer,
        mimeType: media.mimeType,
        filename: media.filename,
      });
      result.bySlide.set(slideNum, list);
      collected += 1;
    }
  }

  // 2. 未被任何 slide 引用（或归属解析失败）的媒体 → 「文稿插图」统一段
  for (const [mediaPath, media] of mediaByPath) {
    if (attributed.has(mediaPath)) {
      continue;
    }
    if (collected >= maxCount) {
      truncated += 1;
      continue;
    }
    const buffer = await zip.files[mediaPath].async('nodebuffer');
    if (!buffer || buffer.length === 0) {
      continue;
    }
    result.unattributed.push({
      placement: 'misc',
      position: 0,
      buffer,
      mimeType: media.mimeType,
      filename: media.filename,
    });
    collected += 1;
  }

  if (truncated > 0) {
    console.warn(
      `PPTX embedded image extraction truncated at ${maxCount} image(s), skipped ${truncated}.`,
    );
  }
  return result;
}

/** 解析 slide rels：rId → ppt/media/xxx（只取 image 类型关系，Target 按文件名归一） */
function parsePptxImageRelTargets(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const tag of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const xml = tag[0];
    const type = /Type="([^"]*)"/.exec(xml)?.[1] ?? '';
    if (!/\/image$/.test(type)) {
      continue;
    }
    const id = /Id="([^"]*)"/.exec(xml)?.[1];
    const target = /Target="([^"]*)"/.exec(xml)?.[1];
    if (!id || !target) {
      continue;
    }
    const filename = decodeURIComponent(target).split(/[\\/]/).pop();
    if (filename) {
      targets.set(id, `ppt/media/${filename}`);
    }
  }
  return targets;
}

/** 取小写扩展名（无扩展名返回空串） */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
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
