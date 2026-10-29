#!/usr/bin/env node
/**
 * 扫描件 PDF 兜底 OCR 冒烟脚本（离线，不依赖任何外部服务）
 *
 * 覆盖链路：
 *   1. 文本层 PDF：正常提取文本，绝不触发 OCR；
 *   2. 图片型 PDF（扫描件）：触发「逐页文本检测 → 页面渲染成 PNG → Vision OCR」真实链路
 *      （Vision 调用替换为注入的 stub），合成含 `## 第 N 页` 分页标题的 Markdown；
 *   3. 扫描件但未接入 vision provider：抛出带明确语义的错误（不静默产出空文档）；
 *   4. OCR 全部返回空文本：抛出带明确语义的错误（不静默产出空文档）。
 *
 * 夹具在运行时生成到 scripts/fixtures/：
 *   - scanned-sample.pdf：canvas 画带文字 PNG + pdf-lib 打包成纯图片 PDF（无文本层）
 *   - text-sample.pdf：pdf-lib 直接绘制矢量文本（有文本层）
 *   - output/：渲染链路真实产出的页图（由 stub OCR 捕获落盘）
 *
 * 前置：先执行 `pnpm --filter backend run build`（脚本 import dist 编译产物）。
 * 通过标准：全部断言通过，exit 0。
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distParserPath = resolve(
  scriptDir,
  '../dist/src/modules/document/document-parser.util.js',
);

if (!existsSync(distParserPath)) {
  console.error(
    `[smoke-pdf-ocr] dist 编译产物不存在：${distParserPath}\n` +
      '请先执行 `pnpm --filter backend run build` 再运行本脚本。',
  );
  process.exit(1);
}

// dist 产物为 CommonJS，走 ESM-CJS 互操作
const parserModule = await import(distParserPath);
const extractDocumentText = parserModule.extractDocumentText;

const fixturesDir = join(scriptDir, 'fixtures');
const outputDir = join(fixturesDir, 'output');

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

/** 注册 macOS 系统字体，保证 canvas fillText 有字形可用（失败仅影响夹具观感，不影响断言） */
function registerCanvasFont() {
  const candidates = [
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ];
  for (const path of candidates) {
    try {
      if (existsSync(path)) {
        GlobalFonts.registerFromPath(path, 'Helvetica');
        return true;
      }
    } catch {
      // 尝试下一个候选字体
    }
  }
  return false;
}

/** canvas 绘制一页带文字的位图（模拟扫描仪输出），返回 PNG buffer */
function drawScannedPage(label) {
  const canvas = createCanvas(620, 800);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111111';
  ctx.font = '30px Helvetica';
  ctx.fillText(label, 40, 90);
  ctx.font = '18px Helvetica';
  ctx.fillText('Vendor invoice scanning copy - payment within 30 days.', 40, 150);
  ctx.fillText('Approval matrix: PMO -> Finance -> Legal.', 40, 190);
  return canvas.toBuffer('image/png');
}

/** 纯图片 PDF（无文本层）：每页一张整页位图 */
async function buildScannedPdf(path) {
  const pdf = await PDFDocument.create();
  for (const label of ['SCANNED PAGE 1', 'SCANNED PAGE 2']) {
    const png = await pdf.embedPng(drawScannedPage(label));
    const page = pdf.addPage([612, 792]);
    page.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  }
  await writeFile(path, await pdf.save());
}

/** 文本层 PDF：pdf-lib 矢量文字（pdf-parse 可直接提取） */
async function buildTextPdf(path) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const lines = [
    'TEXT-LAYER-PDF-MARKER: this page has a real text layer.',
    'Travel policy: hotel reimbursement cap is 650 CNY per night.',
    'Invoice payment term: within 30 days after acceptance.',
  ];
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 48,
      y: 720 - index * 28,
      size: 14,
      font,
      color: rgb(0.07, 0.07, 0.07),
    });
  });
  await writeFile(path, await pdf.save());
}

/* ── OCR stub ────────────────────────────────────────────── */

/**
 * 注入的 Vision OCR stub：记录每次调用，返回固定文本，
 * 并把收到的页图落盘，用于断言「检测 → 渲染出页图」的真实链路。
 */
function createStubOcr({ textOf }) {
  const calls = [];
  let seq = 0;
  return {
    calls,
    async ocr(imageBuffer, mimeType) {
      // 解析器并发送页 OCR，必须在首个 await 之前同步锁定页码，
      // 否则其他并发调用会先递增 seq，导致页码与识别文本错位。
      const num = seq + 1;
      seq = num;
      const call = {
        num,
        size: imageBuffer.length,
        mimeType,
        buffer: imageBuffer,
      };
      calls.push(call);
      await writeFile(
        join(outputDir, `ocr-input-page-${String(num).padStart(2, '0')}.png`),
        imageBuffer,
      );
      return { text: textOf(num) };
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

async function expectRejected(label, action) {
  try {
    await action();
    check(false, `${label}（实际未抛错）`);
  } catch (err) {
    check(true, `${label} — 抛错信息：${err?.message}`);
  }
}

/* ── 主流程 ─────────────────────────────────────────────── */

async function main() {
  console.log(`[smoke-pdf-ocr] dist parser: ${distParserPath}`);
  console.log(`[smoke-pdf-ocr] canvas font registered: ${registerCanvasFont()}`);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const scannedPdfPath = join(fixturesDir, 'scanned-sample.pdf');
  const textPdfPath = join(fixturesDir, 'text-sample.pdf');
  await buildScannedPdf(scannedPdfPath);
  await buildTextPdf(textPdfPath);
  const scannedPdf = await readFile(scannedPdfPath);
  const textPdf = await readFile(textPdfPath);
  console.log(
    `[smoke-pdf-ocr] fixtures ready: scanned=${scannedPdf.length}B, text=${textPdf.length}B\n`,
  );

  // 用例 1：文本层 PDF 不触发 OCR
  console.log('[case 1] text-layer PDF should NOT trigger OCR');
  const textStub = createStubOcr({ textOf: () => 'SHOULD-NOT-BE-CALLED' });
  const textContent = await extractDocumentText(textPdf, 'pdf', textStub);
  check(
    textContent.includes('TEXT-LAYER-PDF-MARKER'),
    '文本层 PDF 正常提取出矢量文本',
  );
  check(
    textStub.calls.length === 0,
    `OCR stub 未被调用（calls=${textStub.calls.length}）`,
  );

  // 用例 2：扫描件触发 OCR 并合成带分页标题的 Markdown
  console.log('[case 2] scanned PDF triggers OCR fallback');
  const scannedStub = createStubOcr({
    textOf: (num) => `【Stub OCR】第 ${num} 页识别内容：scanned-page-marker-${num}`,
  });
  const scannedContent = await extractDocumentText(
    scannedPdf,
    'pdf',
    scannedStub,
  );
  check(
    scannedContent.includes('# Scanned PDF Document (OCR)'),
    '合成 Markdown 含固定顶部标题',
  );
  check(scannedContent.includes('## 第 1 页'), '含分页标题 `## 第 1 页`');
  check(scannedContent.includes('## 第 2 页'), '含分页标题 `## 第 2 页`');
  check(
    scannedContent.includes('scanned-page-marker-1') &&
      scannedContent.includes('scanned-page-marker-2'),
    '按页合成了 stub OCR 文本',
  );
  check(
    scannedStub.calls.length === 2,
    `OCR stub 每页调用一次（calls=${scannedStub.calls.length}）`,
  );
  check(
    scannedStub.calls.every((call) => isPng(call.buffer) && call.size > 1000),
    `OCR 输入为真实渲染出的 PNG 页图（sizes=${scannedStub.calls
      .map((call) => `${call.num}:${call.size}B`)
      .join(', ')}）`,
  );

  const renderedFiles = (await readdir(outputDir)).filter((name) =>
    name.endsWith('.png'),
  );
  console.log(
    `[smoke-pdf-ocr] rendered page images in ${outputDir}: ${renderedFiles.join(', ') || '(none)'}`,
  );
  check(
    renderedFiles.length === 2,
    '渲染链路真实产出 2 张页图并落盘',
  );

  // 用例 3：扫描件 + 未接入 OCR → 明确报错，不静默产出空文档
  console.log('[case 3] scanned PDF without vision provider must fail loudly');
  await expectRejected(
    '未接入 vision provider 时抛出明确错误',
    () => extractDocumentText(scannedPdf, 'pdf'),
  );

  // 用例 4：OCR 全空 → 明确报错，不静默入库空文档
  console.log('[case 4] scanned PDF with empty OCR output must fail loudly');
  const emptyStub = createStubOcr({ textOf: () => '   ' });
  await expectRejected(
    'OCR 全部返回空文本时抛出明确错误',
    () => extractDocumentText(scannedPdf, 'pdf', emptyStub),
  );

  console.log('');
  if (failures.length > 0) {
    console.error(`[smoke-pdf-ocr] FAILED: ${failures.length} assertion(s)`);
    process.exit(1);
  }
  console.log('[smoke-pdf-ocr] ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[smoke-pdf-ocr] unexpected error: ${err?.stack ?? err}`);
  process.exit(1);
});
