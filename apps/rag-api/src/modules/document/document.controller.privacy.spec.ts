import { BadRequestException } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { parseDocument, validateDocumentFormat } from './document-parser.util';
import type { ParsedDocument } from './document-parser.types';

jest.mock('./document-parser.util', () => ({
  createParsedDocument: jest.fn(),
  detectDocumentKind: jest.fn(),
  extractImageDocumentText: jest.fn(),
  extractUrlContent: jest.fn(),
  parseDocument: jest.fn(),
  validateDocumentFormat: jest.fn(),
}));

const parseDocumentMock = jest.mocked(parseDocument);
const validateFormatMock = jest.mocked(validateDocumentFormat);

describe('DocumentController MinerU privacy preflight', () => {
  const originalExtractImages = process.env.DOCUMENT_EXTRACT_IMAGES;
  let controller: DocumentController;
  let cloud: {
    accepts: jest.Mock;
    parse: jest.Mock;
    fallbackEnabled: jest.Mock;
  };
  let privacy: { redactTextFields: jest.Mock; redactText: jest.Mock };

  beforeEach(() => {
    delete process.env.DOCUMENT_EXTRACT_IMAGES;
    parseDocumentMock.mockReset();
    validateFormatMock.mockReset().mockResolvedValue(undefined);
    cloud = {
      accepts: jest.fn().mockReturnValue(true),
      parse: jest.fn().mockResolvedValue(parsedDocument('# Cloud result')),
      fallbackEnabled: jest.fn().mockReturnValue(true),
    };
    privacy = {
      redactTextFields: jest.fn(
        (value: { parsedDocument: ParsedDocument; filename: string }) =>
          Promise.resolve({ value, entityTypes: [] as string[] }),
      ),
      redactText: jest.fn((text: string) =>
        Promise.resolve({ text, entityTypes: [] as string[] }),
      ),
    };
    const queue = {
      registerProcessor: jest.fn(),
      registerFailureHandler: jest.fn(),
    };
    controller = new DocumentController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      queue as never,
      {} as never,
      {} as never,
      cloud as never,
      privacy as never,
    );
    parseDocumentMock.mockResolvedValue(parsedDocument('# Local result'));
  });

  afterAll(() => {
    if (originalExtractImages === undefined) {
      delete process.env.DOCUMENT_EXTRACT_IMAGES;
    } else {
      process.env.DOCUMENT_EXTRACT_IMAGES = originalExtractImages;
    }
  });

  it('sends the original file to MinerU only after a complete clean local preflight', async () => {
    const file = uploadFile('clean.pdf');
    const result = await extract(controller, file);

    expect(result.markdown).toBe('# Cloud result');
    expect(parseDocumentMock).toHaveBeenCalledTimes(1);
    expect(parseDocumentMock.mock.calls[0][2]).toBeUndefined();
    expect(parseDocumentMock.mock.calls[0][3]).toMatchObject({
      vision: undefined,
    });
    expect(cloud.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: file.buffer,
        filename: file.originalname,
      }),
    );
  });

  it('uses redacted local content and skips MinerU when privacy is detected', async () => {
    const local = parsedDocument('# Local [手机号]');
    parseDocumentMock.mockResolvedValue(local);
    privacy.redactTextFields.mockResolvedValue({
      value: { parsedDocument: local, filename: 'private.pdf' },
      entityTypes: ['CN_MOBILE_PHONE'],
    });

    const result = await extract(controller, uploadFile('private.pdf'));

    expect(cloud.parse).not.toHaveBeenCalled();
    expect(result.markdown).toContain('[手机号]');
    expect(result.warnings.at(-1)?.code).toBe(
      'mineru_cloud_skipped_for_privacy',
    );
  });

  it('uses local partial content and skips MinerU when preflight is incomplete', async () => {
    parseDocumentMock.mockResolvedValue({
      ...parsedDocument('# Local partial'),
      status: 'partial',
      completeness: 0.8,
      warnings: [{ code: 'pdf_ocr_unavailable', message: 'OCR unavailable' }],
    });

    const result = await extract(controller, uploadFile('partial.pdf'));

    expect(cloud.parse).not.toHaveBeenCalled();
    expect(result.status).toBe('partial');
    expect(result.completeness).toBe(0.8);
    expect(result.warnings.at(-1)?.code).toBe(
      'mineru_cloud_privacy_preflight_incomplete',
    );
  });

  it('blocks MinerU and fails closed when local parsing cannot produce content', async () => {
    parseDocumentMock.mockResolvedValue({
      ...parsedDocument(''),
      markdown: '',
      blocks: [],
      status: 'failed',
      completeness: 0,
    });

    await expect(
      extract(controller, uploadFile('broken.pdf')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cloud.parse).not.toHaveBeenCalled();
  });

  it('skips MinerU when local parsed blocks contain images without OCR', async () => {
    parseDocumentMock.mockResolvedValue({
      ...parsedDocument('# Local text'),
      blocks: [
        { type: 'paragraph', text: 'Local text' },
        { type: 'image', text: 'chart.png', asset: { alt: 'chart.png' } },
      ],
    });

    const result = await extract(controller, uploadFile('diagram.pdf'));

    expect(cloud.parse).not.toHaveBeenCalled();
    expect(result.status).toBe('partial');
    expect(result.warnings.at(-1)?.code).toBe(
      'mineru_cloud_privacy_preflight_incomplete',
    );
  });

  it('fails closed without sending the file when local privacy analysis fails', async () => {
    privacy.redactTextFields.mockRejectedValue(
      new Error('Analyzer unavailable'),
    );

    await expect(
      extract(controller, uploadFile('private.pdf')),
    ).rejects.toThrow('Analyzer unavailable');
    expect(cloud.parse).not.toHaveBeenCalled();
  });
});

async function extract(
  controller: DocumentController,
  file: Express.Multer.File,
): Promise<ParsedDocument> {
  return (
    controller as unknown as {
      extractUploadContent(
        file: Express.Multer.File,
        kind: 'pdf',
        userId: string,
      ): Promise<ParsedDocument>;
    }
  ).extractUploadContent(file, 'pdf', 'user-1');
}

function uploadFile(originalname: string): Express.Multer.File {
  return {
    originalname,
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 local fixture'),
  } as Express.Multer.File;
}

function parsedDocument(markdown: string): ParsedDocument {
  return {
    kind: 'pdf',
    title: 'PDF Document',
    blocks: markdown ? [{ type: 'paragraph', text: markdown }] : [],
    markdown,
    status: 'complete',
    completeness: 1,
    warnings: [],
  };
}
