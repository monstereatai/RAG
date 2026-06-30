import {
  detectDocumentKind,
  extractDocumentText,
} from './document-parser.util';

describe('document-parser.util', () => {
  it('detects newly supported text-like document kinds', () => {
    expect(detectDocumentKind('report.csv')).toBe('csv');
    expect(detectDocumentKind('data.JSON')).toBe('json');
    expect(detectDocumentKind('page.html')).toBe('html');
  });

  it('converts csv documents to markdown tables', async () => {
    const text = await extractDocumentText(
      Buffer.from('name,role\nAlice,admin\n"Bob, Jr",user'),
      'csv',
    );

    expect(text).toContain('# CSV Document');
    expect(text).toContain('| name | role |');
    expect(text).toContain('| Alice | admin |');
    expect(text).toContain('| Bob, Jr | user |');
  });

  it('converts json object arrays to markdown tables', async () => {
    const text = await extractDocumentText(
      Buffer.from(
        JSON.stringify([
          { name: 'Alice', role: 'admin' },
          { name: 'Bob', role: 'user' },
        ]),
      ),
      'json',
    );

    expect(text).toContain('# JSON Document');
    expect(text).toContain('| name | role |');
    expect(text).toContain('| Alice | admin |');
  });

  it('extracts readable text from html documents', async () => {
    const text = await extractDocumentText(
      Buffer.from(
        '<html><head><title>Policy</title><style>.x{}</style></head><body><main><h1>制度</h1><p>报销上限 650 元。</p></main></body></html>',
      ),
      'html',
    );

    expect(text).toContain('# Policy');
    expect(text).toContain('制度');
    expect(text).toContain('报销上限 650 元。');
    expect(text).not.toContain('.x{}');
  });
});
