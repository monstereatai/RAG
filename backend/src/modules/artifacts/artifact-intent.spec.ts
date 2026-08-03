import { parseArtifactIntent } from './artifact-intent';

describe('parseArtifactIntent', () => {
  it.each([
    ['请生成一份 Word 文档', 'word'],
    ['帮我导出 Excel 文件', 'excel'],
    ['整理成 md 文档', 'markdown'],
    ['给我做一个系统架构图', 'architecture'],
    ['制作一张活动主视觉图片', 'image'],
    ['生成 world 文件', 'word'],
  ])('recognizes executable artifact request: %s', (query, kind) => {
    expect(parseArtifactIntent(query)?.kind).toBe(kind);
  });

  it.each([
    'Word 和 Markdown 有什么区别',
    '怎么生成 Excel 文件',
    '解释一下系统架构图',
    '总结这份文档',
    '下载已有的 Word 文件',
  ])('does not trigger for capability questions: %s', (query) => {
    expect(parseArtifactIntent(query)).toBeNull();
  });
});
