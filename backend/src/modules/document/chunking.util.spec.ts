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

  it('keeps heading path, table semantics, and clause numbers in chunks', async () => {
    const chunker = new MarkdownChunker(500, 50);
    const text = [
      '# 员工手册',
      '## 薪酬制度',
      '第一条 基本工资按月发放。',
      '',
      '| 项目 | 规则 |',
      '| --- | --- |',
      '| 绩效奖金 | 按季度评估 |',
    ].join('\n');

    const chunks = await chunker.split(text);
    const joined = chunks.join('\n');

    expect(joined).toContain('章节路径：员工手册 > 薪酬制度');
    expect(joined).toContain('条款编号：第一条');
    expect(joined).toContain('表格行：项目=绩效奖金；规则=按季度评估');
  });

  it('returns structured source span and parent chunk metadata', async () => {
    const chunker = new MarkdownChunker(500, 50);
    const chunks = await chunker.splitStructured(
      ['# 制度', '## 差旅', '第一条 2026 版住宿报销上限为 650 元。'].join('\n'),
    );

    const contentChunk = chunks.at(-1);
    expect(contentChunk).toMatchObject({
      parentChunkId: 'section-1',
      headingPath: ['制度', '差旅'],
      sectionId: 'section-1',
      clauseId: '第一条',
      tableRef: null,
    });
    expect(contentChunk?.sourceStart).toBeGreaterThan(0);
    expect(contentChunk?.sourceEnd).toBeGreaterThan(
      contentChunk?.sourceStart ?? 0,
    );
  });
});
