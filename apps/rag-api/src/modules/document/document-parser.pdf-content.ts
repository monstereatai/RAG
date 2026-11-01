import { BadRequestException } from '@nestjs/common';
import {
  uploadEmbeddedImages,
  groupImagesByPosition,
  isImageExtractionEnabled,
  hasImageStorage,
} from './document-parser.image';
import {
  countSignificantChars,
  isScannedPdfPage,
  ocrPdfPages,
  loadNapiCanvas,
  loadPdfjs,
  polyfillCanvasGlobals,
  lockPdfjsFakeWorker,
} from './document-parser.pdf-render';
import { dynamicImport, envPositiveNumber } from './document-parser.shared';
import type {
  DocumentOcrDelegate,
  DocumentImageExtractionOptions,
  EmbeddedImageAsset,
  ParsedDocument,
  ParsedDocumentWarning,
  UploadedEmbeddedImage,
  PdfjsPage,
  PdfjsImageData,
  NapiCanvasModule,
} from './document-parser.types';

/** 扫描件兜底 OCR：每页首次识别失败后再重试一次（共 2 次尝试） */
export async function extractPdfText(
  buffer: Buffer,
  ocr?: DocumentOcrDelegate,
  images?: DocumentImageExtractionOptions,
  preservePages = false,
): Promise<string> {
  const parsed = await parsePdfDocument(buffer, ocr, images, preservePages);
  if (preservePages || parsed.blocks.some((block) => block.type === 'image')) {
    return parsed.markdown;
  }
  return parsed.blocks
    .filter((block) => block.type === 'paragraph')
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

/** 解析 PDF 为带页码、状态和告警的结构化结果。 */
export async function parsePdfDocument(
  buffer: Buffer,
  ocr?: DocumentOcrDelegate,
  images?: DocumentImageExtractionOptions,
  preservePages = true,
): Promise<ParsedDocument> {
  // pdf-parse 会在模块加载时初始化 @napi-rs/canvas 的 native GC 句柄。
  // 延迟到真正解析 PDF 时再加载，避免普通文本/Office 入库和 Jest 启动阶段泄漏句柄。
  const { PDFParse } =
    await dynamicImport<typeof import('pdf-parse')>('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let textResult;
  try {
    textResult = await parser.getText();
  } finally {
    await parser.destroy();
  }

  const totalPages = Math.max(
    1,
    textResult.total || 0,
    textResult.pages.length,
  );
  const nativePages = new Map(
    textResult.pages.map((page) => [page.num, page.text.trim()]),
  );
  if (textResult.pages.length === 0 && textResult.text.trim()) {
    nativePages.set(1, textResult.text.trim());
  }

  const pageNumbers = Array.from(
    { length: totalPages },
    (_, index) => index + 1,
  );
  const scanPages = pageNumbers.filter((pageNumber) =>
    isScannedPdfPage({ text: nativePages.get(pageNumber) ?? '' }),
  );
  const warnings: ParsedDocumentWarning[] = [];
  const pageTexts = new Map(nativePages);
  const ocrResult = await ocrPdfPages(buffer, scanPages, totalPages, ocr);
  warnings.push(...ocrResult.warnings);
  for (const page of ocrResult.pages) {
    if (page.text.trim()) {
      pageTexts.set(page.num, page.text.trim());
    }
  }

  const uploadedByPage = new Map<number, UploadedEmbeddedImage[]>();
  if (images && isImageExtractionEnabled() && hasImageStorage(images)) {
    const nativeTextPageNumbers = pageNumbers.filter(
      (pageNumber) => !scanPages.includes(pageNumber),
    );
    if (nativeTextPageNumbers.length > 0) {
      const imagePageLimit = Math.min(
        Math.max(
          1,
          envPositiveNumber(
            'PDF_IMAGE_MAX_PAGES',
            envPositiveNumber('PDF_OCR_MAX_PAGES', 20),
          ),
        ),
        totalPages,
      );
      const pagesForImages = nativeTextPageNumbers.filter(
        (pageNumber) => pageNumber <= imagePageLimit,
      );
      for (const pageNumber of nativeTextPageNumbers) {
        if (pageNumber > imagePageLimit) {
          warnings.push({
            code: 'pdf_image_page_limit',
            message: `超过 PDF_IMAGE_MAX_PAGES=${imagePageLimit}，第 ${pageNumber} 页未提取内嵌图片。`,
            pageNumber,
          });
        }
      }
      try {
        const { assets, skipped } = await extractPdfEmbeddedImages(
          buffer,
          imagePageLimit,
          pagesForImages,
        );
        if (skipped > 0) {
          warnings.push({
            code: 'pdf_image_extraction_partial',
            message: `有 ${skipped} 个 PDF 内嵌图片对象未能提取。`,
          });
        }
        if (assets.length > 0) {
          const uploaded = await uploadEmbeddedImages(assets, images);
          for (const image of uploaded) {
            const pageImages = uploadedByPage.get(image.position) ?? [];
            pageImages.push(image);
            uploadedByPage.set(image.position, pageImages);
          }
        }
      } catch (err) {
        warnings.push({
          code: 'pdf_image_extraction_failed',
          message: `PDF 内嵌图片提取失败：${(err as Error).message}`,
        });
      }
    }
  }

  const blocks: ParsedDocument['blocks'] = [];
  for (const pageNumber of pageNumbers) {
    const pageText = pageTexts.get(pageNumber)?.trim() ?? '';
    if (pageText) {
      blocks.push({ type: 'paragraph', text: pageText, pageNumber });
    }
    for (const image of uploadedByPage.get(pageNumber) ?? []) {
      blocks.push({
        type: 'image',
        text: image.alt,
        pageNumber,
        asset: { url: image.url, alt: image.alt },
      });
    }
  }

  if (
    !blocks.some(
      (block) =>
        block.type === 'paragraph' && countSignificantChars(block.text) > 0,
    )
  ) {
    throw new BadRequestException(
      'PDF parsing produced no searchable text; refusing to index an empty document.',
    );
  }

  const markdown = composeParsedPdfMarkdown(blocks, preservePages);
  const affectedPages = new Set(
    warnings
      .map((warning) => warning.pageNumber)
      .filter((pageNumber): pageNumber is number => pageNumber !== undefined),
  );
  const hasDocumentWarning = warnings.some(
    (warning) => warning.pageNumber === undefined,
  );
  const incompletePages = Math.min(
    totalPages,
    affectedPages.size + (hasDocumentWarning ? 1 : 0),
  );

  return {
    kind: 'pdf',
    title: 'PDF Document',
    blocks,
    markdown,
    status: warnings.length > 0 ? 'partial' : 'complete',
    completeness: Math.max(0, (totalPages - incompletePages) / totalPages),
    warnings,
  };
}

function composeParsedPdfMarkdown(
  blocks: ParsedDocument['blocks'],
  preservePages: boolean,
): string {
  const sections: string[] = [];
  let currentPage: number | undefined;
  for (const block of blocks) {
    if (preservePages && block.pageNumber !== currentPage) {
      currentPage = block.pageNumber;
      sections.push(`## 第 ${currentPage} 页`);
    }
    if (block.type === 'image') {
      sections.push(
        `![${block.asset?.alt ?? block.text}](${block.asset?.url ?? ''})`,
      );
    } else if (block.text.trim()) {
      sections.push(block.text.trim());
    }
  }
  return [preservePages ? '# PDF Document' : '', ...sections]
    .filter(Boolean)
    .join('\n\n')
    .trim();
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
export const PDFJS_IMAGE_KIND = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3,
} as const;

/** 等待 pdfjs 图片对象解码完成的兜底超时（getOperatorList 后 objs 可能尚未就绪） */
export const PDFJS_IMAGE_RESOLVE_TIMEOUT_MS = 2_000;

/**
 * 有文本层 PDF 的内嵌图合成：提取 → 上传 → 按「## 第 N 页」分页重组 Markdown。
 * 图片紧跟对应页标题之后；页面无文字且无图片时跳过该页。
 */
export async function composeTextPdfWithImages(
  buffer: Buffer,
  textResult: {
    text: string;
    pages: Array<{ num: number; text: string }>;
    total: number;
  },
  images: DocumentImageExtractionOptions,
  preservePages = false,
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
    return preservePages
      ? composePdfMarkdownWithPages(textResult, new Map())
      : textResult.text;
  }
  const uploaded = await uploadEmbeddedImages(assets, images);
  return composePdfMarkdownWithPages(
    textResult,
    groupImagesByPosition(uploaded),
  );
}

/** 有文本层 PDF 的 Markdown：插入 `## 第 N 页` 分页标题，图片紧跟标题之后 */
export function composePdfMarkdownWithPages(
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
export async function extractPdfEmbeddedImages(
  buffer: Buffer,
  maxPages: number,
  requestedPageNumbers?: number[],
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
      const pageNumbers =
        requestedPageNumbers ??
        Array.from(
          { length: Math.min(doc.numPages, maxPages) },
          (_, index) => index + 1,
        );
      for (const num of pageNumbers) {
        if (num < 1 || num > doc.numPages || num > maxPages) {
          continue;
        }
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
export function buildPdfImageAsset(
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
export function parsePdfjsRefNumber(ref: unknown): number | null {
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
export function extractRawJpegStream(
  raw: Buffer,
  objNum: number,
): Buffer | null {
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
export function resolvePdfjsImageObject(
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
export function encodePdfjsImageToPng(
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
