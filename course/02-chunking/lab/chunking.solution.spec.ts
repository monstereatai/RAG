import { MarkdownChunker } from '../../../backend/src/modules/document/chunking.util';

/**
 * Lab 02 · 参考答案自检
 * 直接对生产实现 backend/src/modules/document/chunking.util.ts
 * 跑与学员版（chunking.student.spec.ts）完全相同的 3 个用例，
 * 证明"参考答案 = 生产代码"本身全绿，同时防止生产代码演进后与 Lab 题目脱节。
 *
 * 运行（无需拷贝任何文件）：
 * cd backend && npx jest --config ../course/02-chunking/lab/jest.inplace.config.json chunking.solution
 */
describe('Lab 02 · 参考答案（生产实现）自检', () => {
  it('①② 表格语义化、章节路径与条款编号', async () => {
    const chunker = new MarkdownChunker(500, 50);
    const chunks = await chunker.split(
      [
        '# 员工手册',
        '## 薪酬制度',
        '第一条 基本工资按月发放。',
        '',
        '| 项目 | 规则 |',
        '| --- | --- |',
        '| 绩效奖金 | 按季度评估 |',
      ].join('\n'),
    );
    const joined = chunks.join('\n');

    expect(joined).toContain('章节路径：员工手册 > 薪酬制度');
    expect(joined).toContain('条款编号：第一条');
    expect(joined).toContain('表格列：项目 / 规则');
    expect(joined).toContain('表格行：项目=绩效奖金；规则=按季度评估');
  });

  it('② 同级标题弹栈：# A → ## B → # C 时，C 的章节路径只剩一级', async () => {
    const chunker = new MarkdownChunker(500, 50);
    const chunks = await chunker.splitStructured(
      ['# A', 'A 下的内容。', '## B', 'B 下的内容。', '# C', 'C 下的内容。'].join(
        '\n',
      ),
    );

    const chunkC = chunks.find((chunk) => chunk.content.includes('C 下的内容'));
    expect(chunkC?.headingPath).toEqual(['C']);
  });

  it('③ 长表格按完整行分组，且每个 chunk 复用表头', async () => {
    const chunker = new MarkdownChunker(95, 5);
    const chunks = await chunker.split(
      [
        '# 抽奖配置',
        '| 奖励 | 概率 | 地区 |',
        '| --- | --- | --- |',
        '| 金币 | 50% | 全部 |',
        '| 皮肤 | 10% | 东南亚 |',
        '| 礼包 | 40% | 台湾服 |',
      ].join('\n'),
    );
    const tableChunks = chunks.filter((chunk) => chunk.includes('表格行：'));

    expect(tableChunks.length).toBeGreaterThan(1);
    expect(
      tableChunks.every((chunk) => chunk.includes('表格列：奖励 / 概率 / 地区')),
    ).toBe(true);
    expect(tableChunks.join('\n')).toContain(
      '表格行：奖励=皮肤；概率=10%；地区=东南亚',
    );
  });
});
