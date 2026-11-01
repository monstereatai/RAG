import { BadRequestException } from '@nestjs/common';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  OCR_MAX_ATTEMPTS_PER_PAGE,
  mapWithConcurrency,
  envPositiveNumber,
  dynamicImport,
} from './document-parser.shared';
import type {
  DocumentOcrDelegate,
  ParsedDocumentWarning,
  PdfPageImage,
  PdfjsModule,
  NapiCanvasModule,
} from './document-parser.types';

/**
 * 判断 PDF 是否为扫描件：逐页统计文本层，
 * 全文有效字符数或平均每页有效字符数低于阈值即判定为扫描件。
 */
export function isScannedPdf(result: {
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
export function countSignificantChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/** 单页有效文本低于阈值时作为扫描页候选，避免文字页掩盖同一 PDF 中的扫描页。 */
export function isScannedPdfPage(page: { text: string }): boolean {
  return (
    countSignificantChars(page.text) <
    envPositiveNumber('PDF_SCANNED_MIN_CHARS_PER_PAGE', 10)
  );
}

/** 按页尝试 OCR；单页失败/空结果成为 warning，其他页继续解析。 */
export async function ocrPdfPages(
  buffer: Buffer,
  pageNumbers: number[],
  totalPages: number,
  ocr?: DocumentOcrDelegate,
): Promise<{
  pages: Array<{ num: number; text: string }>;
  warnings: ParsedDocumentWarning[];
}> {
  const requestedPages = [...new Set(pageNumbers)]
    .filter((num) => Number.isInteger(num) && num > 0 && num <= totalPages)
    .sort((a, b) => a - b);
  const maxPages = Math.min(
    Math.max(1, envPositiveNumber('PDF_OCR_MAX_PAGES', 20)),
    Math.max(1, totalPages),
  );
  const pagesToOcr = requestedPages.slice(0, maxPages);
  const warnings: ParsedDocumentWarning[] = requestedPages
    .slice(maxPages)
    .map((pageNumber) => ({
      code: 'pdf_ocr_page_limit',
      message: `超过 PDF_OCR_MAX_PAGES=${maxPages}，第 ${pageNumber} 页未执行 OCR。`,
      pageNumber,
    }));

  if (pagesToOcr.length === 0) {
    return { pages: [], warnings };
  }
  if (!ocr || typeof ocr.ocr !== 'function') {
    warnings.push(
      ...pagesToOcr.map((pageNumber) => ({
        code: 'pdf_ocr_unavailable',
        message: `第 ${pageNumber} 页需要 OCR，但未配置 OCR 服务。`,
        pageNumber,
      })),
    );
    return { pages: [], warnings };
  }

  let pageImages: PdfPageImage[];
  try {
    pageImages = await renderPdfPageImages(buffer, totalPages, pagesToOcr);
  } catch (err) {
    warnings.push(
      ...pagesToOcr.map((pageNumber) => ({
        code: 'pdf_page_render_failed',
        message: `第 ${pageNumber} 页渲染失败：${(err as Error).message}`,
        pageNumber,
      })),
    );
    return { pages: [], warnings };
  }

  const imagesByPage = new Map(pageImages.map((image) => [image.num, image]));
  for (const pageNumber of pagesToOcr) {
    if (!imagesByPage.has(pageNumber)) {
      warnings.push({
        code: 'pdf_page_render_missing',
        message: `第 ${pageNumber} 页未生成 OCR 图片。`,
        pageNumber,
      });
    }
  }

  const results = await mapWithConcurrency(
    pageImages,
    Math.max(1, envPositiveNumber('PDF_OCR_CONCURRENCY', 3)),
    async (image) => {
      try {
        const text = await ocrPageWithRetry(ocr, image);
        if (!text.trim()) {
          warnings.push({
            code: 'pdf_page_ocr_empty',
            message: `第 ${image.num} 页 OCR 未识别到正文。`,
            pageNumber: image.num,
          });
        }
        return { num: image.num, text: text.trim() };
      } catch (err) {
        warnings.push({
          code: 'pdf_page_ocr_failed',
          message: (err as Error).message,
          pageNumber: image.num,
        });
        return { num: image.num, text: '' };
      }
    },
  );
  results.sort((a, b) => a.num - b.num);
  return { pages: results, warnings };
}

/**
 * 扫描件兜底 OCR 主流程：渲染页图 → 并发 OCR（并发 ≤ N、失败重试 1 次）→ 合成 Markdown。
 *
 * 未接入 OCR 依赖、页图渲染失败或 OCR 后整份文档仍无文字时，
 * 都会抛出带明确语义的错误，绝不静默产出空文档。
 */
export async function ocrScannedPdf(
  buffer: Buffer,
  totalPages: number,
  ocr?: DocumentOcrDelegate,
): Promise<string> {
  const pageNumbers = Array.from(
    { length: Math.max(0, totalPages) },
    (_, index) => index + 1,
  );
  const result = await ocrPdfPages(buffer, pageNumbers, totalPages, ocr);
  const recognizedChars = result.pages.reduce(
    (sum, page) => sum + countSignificantChars(page.text),
    0,
  );
  if (recognizedChars === 0) {
    throw new BadRequestException(
      `Scanned PDF fallback OCR finished but recognized no text in ${pageNumbers.length} page(s); ` +
        'refusing to ingest an empty document. Check the vision provider model/key.',
    );
  }
  return composeOcrMarkdown(result.pages);
}

/** 单页 OCR：失败自动重试 1 次，仍失败则抛出带页码语义的错误 */
export async function ocrPageWithRetry(
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
export function composeOcrMarkdown(
  pages: Array<{ num: number; text: string }>,
): string {
  const sections = pages
    .filter((page) => page.text.trim())
    .map((page) => [`## 第 ${page.num} 页`, '', page.text.trim()].join('\n'));
  return ['# Scanned PDF Document (OCR)', '', ...sections].join('\n\n').trim();
}

/**
 * 渲染扫描件 PDF 页面为图片（最多 maxPages 页）。
 *
 * 优先使用系统 poppler 的 pdftoppm（安装成本低、渲染质量稳定），
 * 本机未安装时回退到内置的 pdfjs-dist + @napi-rs/canvas 渲染器。
 */
export async function renderPdfPageImages(
  buffer: Buffer,
  maxPages: number,
  requestedPageNumbers?: number[],
): Promise<PdfPageImage[]> {
  const pageNumbers = normalizePageNumbers(maxPages, requestedPageNumbers);
  if (pageNumbers.length === 0) {
    return [];
  }
  if (hasPdftoppm()) {
    try {
      return await renderPdfPageImagesWithPdftoppm(
        buffer,
        maxPages,
        pageNumbers,
      );
    } catch (err) {
      // poppler 调用异常时降级到内置渲染器，不让扫描件 OCR 因环境问题直接失败
      console.warn(
        `pdftoppm rendering failed, falling back to pdfjs renderer: ${(err as Error).message}`,
      );
    }
  }
  return renderPdfPageImagesWithPdfjs(buffer, maxPages, pageNumbers);
}

function normalizePageNumbers(
  maxPages: number,
  requestedPageNumbers?: number[],
): number[] {
  const source =
    requestedPageNumbers ??
    Array.from({ length: Math.max(0, maxPages) }, (_, index) => index + 1);
  return [...new Set(source)]
    .filter((num) => Number.isInteger(num) && num > 0 && num <= maxPages)
    .sort((a, b) => a - b);
}

export let pdftoppmAvailable: boolean | null = null;

/** 探测系统是否安装 poppler 的 pdftoppm（结果进程内缓存） */
export function hasPdftoppm(): boolean {
  if (pdftoppmAvailable === null) {
    const probe = spawnSync('which', ['pdftoppm'], { encoding: 'utf-8' });
    pdftoppmAvailable = probe.status === 0 && Boolean(probe.stdout?.trim());
  }
  return pdftoppmAvailable;
}

/** pdftoppm 渲染：写临时 PDF → spawn pdftoppm → 收集页图 PNG */
export async function renderPdfPageImagesWithPdftoppm(
  buffer: Buffer,
  maxPages: number,
  requestedPageNumbers?: number[],
): Promise<PdfPageImage[]> {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-ocr-'));
  const prefix = join(dir, 'page');
  const dpi = envPositiveNumber('PDF_OCR_DPI', 150);
  try {
    await writeFile(`${prefix}.pdf`, buffer);
    const pageNumbers = normalizePageNumbers(maxPages, requestedPageNumbers);
    const ranges = pageNumbers.reduce<Array<[number, number]>>(
      (result, num) => {
        const last = result[result.length - 1];
        if (last && num === last[1] + 1) {
          last[1] = num;
        } else {
          result.push([num, num]);
        }
        return result;
      },
      [],
    );
    for (const [firstPage, lastPage] of ranges) {
      await new Promise<void>((resolveP, rejectP) => {
        const child = spawn('pdftoppm', [
          '-png',
          '-r',
          String(dpi),
          '-f',
          String(firstPage),
          '-l',
          String(lastPage),
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
    }

    const files = await readdir(dir);
    const pageFiles = files
      .map((name) => /^page-(\d+)\.png$/.exec(name))
      .filter(Boolean)
      .sort((a, b) => Number(a![1]) - Number(b![1]));
    const pages: PdfPageImage[] = [];
    for (const match of pageFiles) {
      const num = Number(match![1]);
      if (!pageNumbers.includes(num)) {
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

export async function loadNapiCanvas(): Promise<NapiCanvasModule> {
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
export async function loadPdfjs(): Promise<PdfjsModule> {
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
export function polyfillCanvasGlobals(canvasModule: NapiCanvasModule): void {
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
export async function lockPdfjsFakeWorker(
  pdfjs: PdfjsModule,
): Promise<() => void> {
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
export async function renderPdfPageImagesWithPdfjs(
  buffer: Buffer,
  maxPages: number,
  requestedPageNumbers?: number[],
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
      const pageNumbers = normalizePageNumbers(
        Math.min(doc.numPages, maxPages),
        requestedPageNumbers,
      );
      for (const num of pageNumbers) {
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
