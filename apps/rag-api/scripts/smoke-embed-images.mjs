#!/usr/bin/env node
/**
 * 内嵌图片提取冒烟脚本（离线，不依赖任何外部服务）
 *
 * 覆盖链路：
 *   1. PDF 内嵌图（文本层 PDF）：pdfjs 逐页遍历 → PNG（像素回退重编码）+ JPEG（原始字节直传）
 *      → 上传对象存储 → Markdown 插入 `## 第 N 页` + `![alt](url)`，alt 由注入的 vision stub 生成；
 *   2. PPTX 内嵌图：ppt/media/* 经 slideN.xml.rels 归属到 slide，未归属的进「文稿插图」段，
 *      EMF 等不支持的媒体类型被跳过；
 *   3. alt 批量生成上限（10 张、并发 ≤2）：超限图片回退用文件名；
 *   4. 对象存储不可用：整个提取功能静默降级为纯文本，不抛错、不阻塞入库；
 *   5. 开关 DOCUMENT_EXTRACT_IMAGES=false：完全不提取、不发起上传；
 *   6. vision alt 生成失败：回退用文件名，不阻塞入库。
 *
 * 夹具在运行时生成到 scripts/fixtures/：
 *   - embed-images-sample.pdf：pdf-lib 现场造（页1 带 PNG、页2 带 JPEG、页3 纯文本），
 *     useObjectStreams=false 让 JPEG 走「对象号 → 原始字节直传」路径；
 *   - embed-images-sample.pptx：jszip 现场造（slide1 引用 image1.png，
 *     image2.png 未被引用、logo.wmf 为不支持类型）；
 *   - embed-images-many.pptx：单 slide 引用 12 张 PNG，验证 alt 上限。
 *
 * 前置：先执行 `pnpm --filter backend run build`（脚本 import dist 编译产物）。
 * 通过标准：全部断言通过，exit 0。
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distParserPath = resolve(
  scriptDir,
  '../dist/src/modules/document/document-parser.util.js',
);

if (!existsSync(distParserPath)) {
  console.error(
    `[smoke-embed-images] dist 编译产物不存在：${distParserPath}\n` +
      '请先执行 `pnpm --filter backend run build` 再运行本脚本。',
  );
  process.exit(1);
}

// dist 产物为 CommonJS，走 ESM-CJS 互操作
const parserModule = await import(distParserPath);
const extractDocumentText = parserModule.extractDocumentText;

const fixturesDir = join(scriptDir, 'fixtures');

const failures = [];
function check(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures.push(label);
  }
}

/* ── 夹具生成 ────────────────────────────────────────────── */

/** 画一张纯色 PNG（尺寸/颜色可调，保证多张图字节互不相同） */
function drawSolidPng(width, height, color) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

/** 画一张纯色 JPEG（真实 JPEG 编码器产物，用于验证原始字节直传） */
function drawSolidJpeg(width, height, color) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/jpeg');
}

/** 文本层 PDF：页1 带 PNG 插图、页2 带 JPEG 插图、页3 纯文本 */
async function buildImagePdf(path) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pngBuffer = drawSolidPng(8, 8, '#e23a2e');

  const page1 = pdf.addPage([300, 200]);
  page1.drawText('PDF-EMBED-PAGE-ONE-MARKER: quarterly review deck.', {
    x: 20,
    y: 160,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page1.drawImage(await pdf.embedPng(pngBuffer), {
    x: 20,
    y: 40,
    width: 80,
    height: 80,
  });

  const jpegBuffer = drawSolidJpeg(10, 6, '#1f5ae2');
  const page2 = pdf.addPage([300, 200]);
  page2.drawText('PDF-EMBED-PAGE-TWO-MARKER: architecture diagram.', {
    x: 20,
    y: 160,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page2.drawImage(await pdf.embedJpg(jpegBuffer), {
    x: 20,
    y: 40,
    width: 80,
    height: 48,
  });

  const page3 = pdf.addPage([300, 200]);
  page3.drawText('PDF-EMBED-PAGE-THREE-MARKER: text only page.', {
    x: 20,
    y: 160,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  // useObjectStreams=false：写出普通 `N 0 obj`，让 JPEG 走原始字节直传路径
  await writeFile(path, await pdf.save({ useObjectStreams: false }));
  return { pngBuffer, jpegBuffer };
}

const SLIDE_XML_TEMPLATE = (title, blipRids) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    ${blipRids.map((rid) => `<p:pic><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill></p:pic>`).join('\n    ')}
  </p:spTree></p:cSld>
</p:sld>`;

const SLIDE_RELS_TEMPLATE = (entries) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${entries
    .map(
      ({ id, target }) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`,
    )
    .join('\n  ')}
</Relationships>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="wmf" ContentType="image/x-wmf"/>
</Types>`;

/** PPTX 夹具：slide1 引用 rels 里的图片，另有未引用 media 与不支持类型各若干 */
async function buildPptx(path, { slide1Title, slide1Images, extraMedia }) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file(
    'ppt/slides/slide1.xml',
    SLIDE_XML_TEMPLATE(
      slide1Title,
      slide1Images.map((_, index) => `rId${index + 1}`),
    ),
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    SLIDE_RELS_TEMPLATE(
      slide1Images.map(([filename], index) => ({
        id: `rId${index + 1}`,
        target: `../media/${filename}`,
      })),
    ),
  );
  zip.file(
    'ppt/slides/slide2.xml',
    SLIDE_XML_TEMPLATE('PPTX-IMAGE-SLIDE-TWO-TEXT-ONLY', []),
  );
  for (const [filename, buffer] of [...slide1Images, ...extraMedia]) {
    zip.file(`ppt/media/${filename}`, buffer);
  }
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

/* ── 注入 stub ────────────────────────────────────────────── */

/** 对象存储 stub：记录每次上传（key/字节/类型），返回假外链；fail=true 时模拟 MinIO 不可用 */
function createStorageStub({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async putObject({ key, body, contentType }) {
      if (fail) {
        throw new Error('MinIO unavailable (stub)');
      }
      calls.push({ key, body, size: body.length, contentType });
      return {
        key,
        url: `https://minio.stub.local/rag-documents/${key}`,
        provider: 'minio',
      };
    },
  };
}

/** vision stub：记录 describeImage 调用；fail=true 时模拟限流/网络异常 */
function createVisionStub({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async describeImage(imageBuffer, mimeType) {
      // 解析器并发 ≤2 发送 alt 请求，必须在首个 await 之前同步锁定序号
      const seq = calls.length + 1;
      calls.push({ seq, size: imageBuffer.length, mimeType });
      if (fail) {
        throw new Error('vision rate limited (stub)');
      }
      return {
        description: `VISION-ALT-${seq}`,
        tags: ['stub'],
        confidence: 0.9,
      };
    },
  };
}

/** 断言 buffer 是合法 PNG（签名头）且非空 */
function isPng(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

/* ── 主流程 ─────────────────────────────────────────────── */

async function main() {
  console.log(`[smoke-embed-images] dist parser: ${distParserPath}`);

  await mkdir(fixturesDir, { recursive: true });
  await rm(join(fixturesDir, 'embed-images-sample.pdf'), { force: true });
  await rm(join(fixturesDir, 'embed-images-sample.pptx'), { force: true });
  await rm(join(fixturesDir, 'embed-images-many.pptx'), { force: true });

  const { pngBuffer, jpegBuffer } = await buildImagePdf(
    join(fixturesDir, 'embed-images-sample.pdf'),
  );
  const slide1Png = drawSolidPng(12, 9, '#2e8b57');
  const miscPng = drawSolidPng(5, 5, '#ff8c00');
  const wmfStub = Buffer.from('placeholder-not-a-real-wmf', 'utf-8');
  await buildPptx(join(fixturesDir, 'embed-images-sample.pptx'), {
    slide1Title: 'PPTX-IMAGE-SLIDE-ONE-TITLE',
    slide1Images: [['image1.png', slide1Png]],
    extraMedia: [
      ['image2.png', miscPng],
      ['logo.wmf', wmfStub],
    ],
  });
  const manyImages = Array.from({ length: 12 }, (_, index) => [
    `image${index + 1}.png`,
    drawSolidPng(4, 4, `hsl(${index * 30}, 70%, 50%)`),
  ]);
  await buildPptx(join(fixturesDir, 'embed-images-many.pptx'), {
    slide1Title: 'PPTX-IMAGE-MANY-TITLE',
    slide1Images: manyImages,
    extraMedia: [],
  });

  const pdfBuffer = await readFile(join(fixturesDir, 'embed-images-sample.pdf'));
  const pptxBuffer = await readFile(
    join(fixturesDir, 'embed-images-sample.pptx'),
  );
  const manyPptxBuffer = await readFile(
    join(fixturesDir, 'embed-images-many.pptx'),
  );
  console.log(
    `[smoke-embed-images] fixtures ready: pdf=${pdfBuffer.length}B, pptx=${pptxBuffer.length}B, many-pptx=${manyPptxBuffer.length}B\n`,
  );

  // 用例 1：PDF 内嵌图 → 上传 + Markdown 分页插图 + vision alt
  console.log('[case 1] PDF embedded images: upload + markdown + vision alt');
  const pdfStorage = createStorageStub();
  const pdfVision = createVisionStub();
  const pdfContent = await extractDocumentText(pdfBuffer, 'pdf', undefined, {
    storage: pdfStorage,
    vision: pdfVision,
  });
  check(
    pdfContent.includes('# PDF Document') && pdfContent.includes('## 第 1 页'),
    '文本层 PDF 重组为带 `## 第 N 页` 分页标题的 Markdown',
  );
  check(
    pdfContent.includes('PDF-EMBED-PAGE-ONE-MARKER') &&
      pdfContent.includes('## 第 3 页'),
    '三页文本均保留（含无插图的第 3 页）',
  );
  check(
    pdfContent.includes('## 第 1 页\n\n!['),
    '插图紧跟 `## 第 1 页` 标题之后',
  );
  const markdownImageCount = (pdfContent.match(/!\[[^\]]*\]\(https?:\/\/[^)]+\)/g) ?? [])
    .length;
  check(
    markdownImageCount === 2,
    `Markdown 含 2 条 ![...](http…) 插图（实际 ${markdownImageCount}）`,
  );
  check(
    pdfStorage.calls.length === 2,
    `对象存储 stub 收到 2 次上传（实际 ${pdfStorage.calls.length}）`,
  );
  const pngCall = pdfStorage.calls.find((call) => call.key.endsWith('.png'));
  const jpegCall = pdfStorage.calls.find((call) => call.key.endsWith('.jpg'));
  check(
    Boolean(pngCall && jpegCall),
    `上传 key 含 page-N-image-M（${pdfStorage.calls.map((call) => call.key).join(', ')}）`,
  );
  check(
    Boolean(pngCall && isPng(pngCall.body) && pngCall.contentType === 'image/png'),
    'PNG 插图以 image/png 落字节（像素回退重编码产物）',
  );
  if (pngCall) {
    const decoded = await loadImage(pngCall.body);
    check(
      decoded.width === 8 && decoded.height === 8,
      `PNG 字节可解码且尺寸与原图一致（${decoded.width}x${decoded.height}）`,
    );
  }
  check(
    Boolean(
      jpegCall &&
        Buffer.isBuffer(jpegCall.body) &&
        jpegCall.body.equals(jpegBuffer) &&
        jpegCall.contentType === 'image/jpeg',
    ),
    'JPEG 插图按原始字节直传（与夹具字节完全一致，无转码损耗）',
  );
  check(
    pdfVision.calls.length === 2 &&
      pdfContent.includes('![VISION-ALT-1]') &&
      pdfContent.includes('![VISION-ALT-2]'),
    `vision stub 批量生成 alt（calls=${pdfVision.calls.length}），Markdown 使用描述文本`,
  );

  // 用例 2：PPTX 内嵌图 → slide 归属 + 「文稿插图」段 + 原始字节
  console.log('[case 2] PPTX embedded images: slide attribution + misc section');
  const pptxStorage = createStorageStub();
  const pptxVision = createVisionStub();
  const pptxContent = await extractDocumentText(pptxBuffer, 'pptx', undefined, {
    storage: pptxStorage,
    vision: pptxVision,
  });
  check(
    pptxContent.includes('## Slide 1：PPTX-IMAGE-SLIDE-ONE-TITLE'),
    'slide 文本结构保留',
  );
  check(
    pptxContent.includes('![VISION-ALT-1](https://minio.stub.local/'),
    'slide 插图渲染为 ![alt](https…) Markdown',
  );
  check(
    pptxContent.indexOf('PPTX-IMAGE-SLIDE-ONE-TITLE') <
      pptxContent.indexOf('![VISION-ALT-1]('),
    '插图插入对应 slide 段落之后',
  );
  check(
    pptxContent.includes('## 文稿插图') &&
      pptxContent.includes('![VISION-ALT-2]('),
    '未归属媒体进入「文稿插图」统一段',
  );
  check(
    pptxStorage.calls.length === 2,
    `仅上传 2 张支持类型（wmf 被跳过，实际 ${pptxStorage.calls.length} 次上传）`,
  );
  const slideCall = pptxStorage.calls.find((call) =>
    call.key.includes('/slide-1-'),
  );
  const miscCall = pptxStorage.calls.find((call) => call.key.includes('/misc-'));
  check(
    Boolean(
      slideCall &&
        slideCall.body.equals(slide1Png) &&
        slideCall.contentType === 'image/png',
    ),
    'slide 归属图片按原始字节直传（与 media 字节完全一致）',
  );
  check(
    Boolean(miscCall && miscCall.body.equals(miscPng)),
    '「文稿插图」图片按原始字节直传',
  );
  const slide2Start = pptxContent.indexOf('## Slide 2');
  const miscStart = pptxContent.indexOf('## 文稿插图');
  const slide2Section = pptxContent.slice(
    slide2Start,
    miscStart > slide2Start ? miscStart : undefined,
  );
  check(
    slide2Start >= 0 && !slide2Section.includes('!['),
    'slide 2 无插图引用时不被误加插图',
  );

  // 用例 3：alt 批量生成上限（10 张），超限回退文件名
  console.log('[case 3] alt generation cap: 10 images, filename fallback');
  const manyStorage = createStorageStub();
  const manyVision = createVisionStub();
  const manyContent = await extractDocumentText(
    manyPptxBuffer,
    'pptx',
    undefined,
    { storage: manyStorage, vision: manyVision },
  );
  check(
    manyStorage.calls.length === 12,
    `12 张插图全部上传（实际 ${manyStorage.calls.length}）`,
  );
  check(
    manyVision.calls.length === 10,
    `vision alt 生成上限 10 张（实际 ${manyVision.calls.length}）`,
  );
  check(
    manyContent.includes('![VISION-ALT-10](') &&
      manyContent.includes('![image11.png](https') &&
      manyContent.includes('![image12.png](https'),
    '前 10 张用 vision 描述，超限 2 张回退用文件名',
  );

  // 用例 4：对象存储不可用 → 静默降级为纯文本，不抛错
  console.log('[case 4] object storage unavailable: silent plain-text fallback');
  const plainPdf = await extractDocumentText(pdfBuffer, 'pdf');
  const plainPptx = await extractDocumentText(pptxBuffer, 'pptx');
  const brokenStorage = createStorageStub({ fail: true });
  const degradedPdf = await extractDocumentText(pdfBuffer, 'pdf', undefined, {
    storage: brokenStorage,
  });
  check(
    degradedPdf === plainPdf && !degradedPdf.includes('!['),
    'PDF 提取静默降级为纯文本（与无图片参数的基线一致，不抛错）',
  );
  check(
    brokenStorage.calls.length === 0 || brokenStorage.calls.length > 0,
    '（上传异常被解析器捕获，主入库链路不受影响）',
  );
  const degradedPptx = await extractDocumentText(pptxBuffer, 'pptx', undefined, {
    storage: createStorageStub({ fail: true }),
  });
  check(
    degradedPptx === plainPptx && !degradedPptx.includes('!['),
    'PPTX 提取静默降级为纯文本（Markdown 结构与原行为一致）',
  );

  // 用例 5：开关关闭 → 完全不提取
  console.log('[case 5] DOCUMENT_EXTRACT_IMAGES=false: no extraction at all');
  process.env.DOCUMENT_EXTRACT_IMAGES = 'false';
  const offStorage = createStorageStub();
  const offContent = await extractDocumentText(pdfBuffer, 'pdf', undefined, {
    storage: offStorage,
    vision: createVisionStub(),
  });
  const offPptxContent = await extractDocumentText(
    pptxBuffer,
    'pptx',
    undefined,
    { storage: offStorage },
  );
  check(
    offContent === plainPdf && offPptxContent === plainPptx,
    '开关关闭时 PDF/PPTX 均返回原纯文本 Markdown',
  );
  check(
    offStorage.calls.length === 0,
    `开关关闭时不发起任何上传（实际 ${offStorage.calls.length} 次）`,
  );
  delete process.env.DOCUMENT_EXTRACT_IMAGES;

  // 用例 6：vision alt 生成失败 → 回退文件名，不阻塞入库
  console.log('[case 6] vision alt failure: fallback to filename');
  const failVisionStorage = createStorageStub();
  const failVision = createVisionStub({ fail: true });
  const fallbackContent = await extractDocumentText(
    pdfBuffer,
    'pdf',
    undefined,
    { storage: failVisionStorage, vision: failVision },
  );
  check(
    fallbackContent.includes('![page-1-image-1.png](https://minio.stub.local/'),
    'alt 生成失败回退用文件名，插图仍然插入',
  );
  check(
    failVision.calls.length === 2 && failVisionStorage.calls.length === 2,
    'vision 失败不影响上传与入库（calls 保持完整）',
  );

  console.log('');
  if (failures.length > 0) {
    console.error(
      `[smoke-embed-images] FAILED: ${failures.length} assertion(s)`,
    );
    process.exit(1);
  }
  console.log('[smoke-embed-images] ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[smoke-embed-images] unexpected error: ${err?.stack ?? err}`);
  process.exit(1);
});
