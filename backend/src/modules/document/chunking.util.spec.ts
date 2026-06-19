import { MarkdownChunker } from './chunking.util';

describe('MarkdownChunker', () => {
  it('splits long markdown text into multiple chunks', async () => {
    const chunker = new MarkdownChunker(40, 5);
    const text = [
      '# Title',
      '',
      '第一段内容用于测试中文切分。',
      '',
      'Second paragraph keeps English words together.',
      '',
      '第三段继续补充足够长的内容。',
    ].join('\n');

    const chunks = await chunker.split(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).toContain('Title');
    expect(chunks.join('\n')).toContain('中文切分');
    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
  });

  it('returns no chunks for empty text', async () => {
    const chunker = new MarkdownChunker(40, 5);

    await expect(chunker.split('')).resolves.toEqual([]);
  });
});
