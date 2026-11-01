import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  extractPdfText,
  parsePdfDocument,
} from './document-parser.pdf-content';

jest.setTimeout(30_000);

async function createMixedPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const textPage = pdf.addPage([612, 792]);
  textPage.drawText(
    'NATIVE_PAGE_ONE_MARKER: this page has a valid searchable text layer.',
    { x: 48, y: 720, size: 14, font, color: rgb(0, 0, 0) },
  );

  const canvas = createCanvas(64, 64);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = '#111111';
  context.fillRect(12, 12, 40, 40);
  const scannedPage = await pdf.embedPng(canvas.toBuffer('image/png'));
  for (let index = 0; index < 2; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawImage(scannedPage, { x: 0, y: 0, width: 612, height: 792 });
  }
  return Buffer.from(await pdf.save());
}

async function createTextAndImagePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(
    'NATIVE_PAGE_WITH_IMAGE_MARKER: searchable text and an embedded image.',
    { x: 48, y: 720, size: 14, font, color: rgb(0, 0, 0) },
  );
  const canvas = createCanvas(64, 64);
  const context = canvas.getContext('2d');
  context.fillStyle = '#336699';
  context.fillRect(0, 0, 64, 64);
  const image = await pdf.embedPng(canvas.toBuffer('image/png'));
  page.drawImage(image, { x: 48, y: 520, width: 128, height: 128 });
  return Buffer.from(await pdf.save());
}

describe('structured PDF parsing', () => {
  const originalOcrPageLimit = process.env.PDF_OCR_MAX_PAGES;
  const originalImageFlag = process.env.DOCUMENT_EXTRACT_IMAGES;

  afterEach(() => {
    if (originalOcrPageLimit === undefined) {
      delete process.env.PDF_OCR_MAX_PAGES;
    } else {
      process.env.PDF_OCR_MAX_PAGES = originalOcrPageLimit;
    }
    if (originalImageFlag === undefined) {
      delete process.env.DOCUMENT_EXTRACT_IMAGES;
    } else {
      process.env.DOCUMENT_EXTRACT_IMAGES = originalImageFlag;
    }
  });

  it('merges native text and page OCR, preserves page numbers, and reports the OCR page limit', async () => {
    process.env.PDF_OCR_MAX_PAGES = '1';
    const buffer = await createMixedPdf();
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const ocrCalls: Buffer[] = [];

    const parsed = await parsePdfDocument(buffer, {
      ocr(imageBuffer) {
        ocrCalls.push(imageBuffer);
        return Promise.resolve({
          text: 'OCR_PAGE_TWO_MARKER: scanned content recovered.',
        });
      },
    });

    expect(ocrCalls).toHaveLength(1);
    expect(parsed.status).toBe('partial');
    expect(
      parsed.blocks.find((block) => block.pageNumber === 1)?.text,
    ).toContain('NATIVE_PAGE_ONE_MARKER');
    expect(
      parsed.blocks.find((block) => block.pageNumber === 2)?.text,
    ).toContain('OCR_PAGE_TWO_MARKER');
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'pdf_ocr_page_limit',
          pageNumber: 3,
        }),
      ]),
    );
    expect(parsed.markdown).toContain('## 第 1 页');
    expect(parsed.markdown).toContain('## 第 2 页');
    expect(parsed.markdown).not.toContain('本页未识别出文字');
    expect(parsed.completeness).toBeCloseTo(2 / 3);
  });

  it('rejects a valid scanned PDF when OCR returns no searchable text', async () => {
    const pdf = await PDFDocument.create();
    const canvas = createCanvas(64, 64);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 64, 64);
    const image = await pdf.embedPng(canvas.toBuffer('image/png'));
    const page = pdf.addPage([612, 792]);
    page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
    const buffer = Buffer.from(await pdf.save());

    await expect(
      parsePdfDocument(buffer, {
        ocr() {
          return Promise.resolve({ text: '   ' });
        },
      }),
    ).rejects.toThrow('no searchable text');
  });

  it('keeps native pages and warns when one scanned page returns empty OCR', async () => {
    const buffer = await createMixedPdf();
    const parsed = await parsePdfDocument(buffer, {
      ocr() {
        return Promise.resolve({ text: '' });
      },
    });

    expect(parsed.status).toBe('partial');
    expect(
      parsed.blocks.find((block) => block.pageNumber === 1)?.text,
    ).toContain('NATIVE_PAGE_ONE_MARKER');
    expect(
      parsed.warnings.some(
        (warning) =>
          warning.code === 'pdf_page_ocr_empty' && warning.pageNumber === 2,
      ),
    ).toBe(true);
    expect(parsed.markdown).not.toContain('本页未识别出文字');
    expect(parsed.markdown).not.toContain('## 第 2 页');
  });

  it('keeps the existing string extraction API', async () => {
    const buffer = await createMixedPdf();
    const text = await extractPdfText(buffer, {
      ocr() {
        return Promise.resolve({ text: 'OCR_COMPATIBILITY_MARKER' });
      },
    });

    expect(text).toContain('NATIVE_PAGE_ONE_MARKER');
    expect(text).toContain('OCR_COMPATIBILITY_MARKER');
    expect(text).not.toContain('## 第 1 页');
  });

  it('records embedded image extraction failure as a partial warning', async () => {
    process.env.DOCUMENT_EXTRACT_IMAGES = 'true';
    const buffer = await createTextAndImagePdf();

    const parsed = await parsePdfDocument(buffer, undefined, {
      storage: {
        putObject() {
          return Promise.reject(new Error('storage unavailable'));
        },
      },
    });

    expect(parsed.status).toBe('partial');
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'pdf_image_extraction_failed' }),
      ]),
    );
    expect(parsed.markdown).toContain('NATIVE_PAGE_WITH_IMAGE_MARKER');
  });
});
