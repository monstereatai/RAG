import { BadRequestException } from '@nestjs/common';
import {
  extractDocumentText,
  extractUrlContent,
  parseDocument,
} from './document-parser.util';

describe('document URL extraction safety', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'http://service.internal/config',
  ])('rejects private or local target %s before fetching', async (url) => {
    await expect(extractUrlContent(url)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects non-http protocols before DNS resolution', async () => {
    await expect(extractUrlContent('file:///etc/passwd')).rejects.toThrow(
      'only http and https urls are supported',
    );
  });
});

describe('document parsing contract', () => {
  it('returns structured text blocks with source offsets and heading paths', async () => {
    const parsed = await parseDocument(
      Buffer.from('# 预算\n\n年度费用为 120 万元。', 'utf8'),
      'markdown',
      undefined,
      undefined,
      undefined,
      { filename: 'budget.md' },
    );

    expect(parsed).toMatchObject({
      kind: 'markdown',
      title: 'budget.md',
      status: 'complete',
      completeness: 1,
    });
    expect(parsed.blocks[0]).toMatchObject({
      type: 'title',
      text: '预算',
      sourceStart: 0,
      sourceEnd: 4,
    });
    expect(parsed.blocks[1]).toMatchObject({
      type: 'paragraph',
      headingPath: ['预算'],
    });
  });

  it.each(['doc', 'ppt'] as const)(
    'does not treat printable bytes in a legacy .%s container as body text',
    async (kind) => {
      const signature = Buffer.from('d0cf11e0a1b11ae1', 'hex');
      const buffer = Buffer.concat([
        signature,
        Buffer.from('secret-looking-text'),
      ]);
      const parsed = await parseDocument(
        buffer,
        kind,
        undefined,
        undefined,
        undefined,
        { filename: `legacy.${kind}` },
      );

      expect(parsed.status).toBe('failed');
      expect(parsed.markdown).toBe('');
      expect(parsed.blocks).toHaveLength(0);
      await expect(extractDocumentText(buffer, kind)).rejects.toThrow(
        'verified binary',
      );
    },
  );
});
