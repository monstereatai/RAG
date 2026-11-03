import { DocumentUploadWorkflow } from './document.service.upload-workflow';
import type { ParsedDocument } from './document-parser.types';
import { MarkdownChunker } from './chunking.util';

describe('parsed document ingestion contract', () => {
  it('chunks parsed page and sheet structure into existing heading/source metadata', async () => {
    const markdown = [
      '# Quarterly report',
      '',
      '## 第 2 页',
      '',
      '识别到的正文内容，用于页码和来源定位。',
      '',
      '## 部门预算',
      '',
      '| 部门 | 金额 |',
      '| --- | --- |',
      '| 研发 | 120 |',
    ].join('\n');
    const parsedDocument: ParsedDocument = {
      kind: 'pdf',
      title: 'Quarterly report',
      blocks: [
        {
          type: 'paragraph',
          text: '识别到的正文内容，用于页码和来源定位。',
          pageNumber: 2,
          sourceStart: 24,
          sourceEnd: 43,
        },
        {
          type: 'table',
          text: '| 部门 | 金额 |\n| --- | --- |\n| 研发 | 120 |',
          sheetName: '部门预算',
          sourceStart: 45,
          sourceEnd: 90,
        },
      ],
      markdown,
      status: 'complete',
      completeness: 1,
      warnings: [],
    };
    const chunks = await new MarkdownChunker(500, 50).splitStructured(
      parsedDocument.markdown,
    );

    expect(chunks.some((chunk) => chunk.headingPath.includes('第 2 页'))).toBe(
      true,
    );
    expect(
      chunks.some(
        (chunk) =>
          chunk.headingPath.includes('部门预算') &&
          chunk.sourceStart !== null &&
          chunk.sourceEnd !== null,
      ),
    ).toBe(true);
    expect(chunks.some((chunk) => chunk.tableRef !== null)).toBe(true);
  });

  it('keeps the original file and rejects failed parsing before embedding or indexing', async () => {
    const saveOriginalResource = jest
      .fn()
      .mockResolvedValue('stored://original');
    const embedChunks = jest.fn();
    const updateTask = jest.fn();
    const context = {
      permissionService: {
        assertTenant: jest.fn().mockResolvedValue(undefined),
      },
      privacyService: {
        redactTextFields: jest.fn((value: unknown) =>
          Promise.resolve({ value, entityTypes: [] as string[] }),
        ),
      },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      documentTaskService: {
        upsertTask: jest.fn().mockResolvedValue(undefined),
        updateTask,
      },
      saveOriginalResource,
      documentIndexCoordinator: { embedChunks },
      dingTalk: undefined,
    } as never;
    const workflow = new DocumentUploadWorkflow(context);
    const parsedDocument: ParsedDocument = {
      kind: 'docx',
      title: 'broken.docx',
      blocks: [],
      markdown: '',
      status: 'failed',
      completeness: 0,
      warnings: [
        { code: 'office.invalid_package', message: '缺少 Word 文档主部件' },
      ],
    };

    await expect(
      workflow.upload('broken.docx', '', 'user-1', {
        originalBuffer: Buffer.from('original'),
        parsedDocument,
      }),
    ).rejects.toThrow(
      'document parsing failed; refusing to index invalid content',
    );

    expect(saveOriginalResource).toHaveBeenCalledTimes(1);
    expect(embedChunks).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed', stage: 'failed' }),
    );
  });
});
