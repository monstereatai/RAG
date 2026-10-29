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

  it('repeats the full heading path on every leaf chunk', async () => {
    const chunker = new MarkdownChunker(55, 5);
    const chunks = await chunker.split(
      [
        '# 周年庆活动',
        '## 抽奖规则',
        '第一段描述参与资格、活动时间和用户限制。',
        '',
        '第二段描述奖池库存、抽奖次数和奖励到账规则。',
        '',
        '第三段描述异常补偿、重复请求和客服处理方式。',
      ].join('\n'),
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((chunk) =>
        chunk.startsWith('章节路径：周年庆活动 > 抽奖规则\n'),
      ),
    ).toBe(true);
  });

  it('keeps fenced code with pipes intact and does not parse it as a table', async () => {
    const chunker = new MarkdownChunker(60, 5);
    const chunks = await chunker.split(
      [
        '# 前端接口示例',
        '```ts',
        "const status = loading || retrying ? 'pending' : 'done';",
        "fetch('/api/v1/activity/draw');",
        '```',
      ].join('\n'),
    );
    const joined = chunks.join('\n');

    expect(joined).toContain('内容类型：代码或配置');
    expect(joined).toContain(
      "const status = loading || retrying ? 'pending' : 'done';",
    );
    expect(joined).not.toContain('表格列：');
    expect(chunks.some((chunk) => chunk.includes('```ts'))).toBe(true);
    expect(
      chunks.some((chunk) => chunk.includes("fetch('/api/v1/activity/draw')")),
    ).toBe(true);
  });

  it('splits long tables by complete rows and repeats table headers', async () => {
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
    const tableChunks = chunks.filter((chunk) =>
      chunk.includes('内容类型：配置表'),
    );

    expect(tableChunks.length).toBeGreaterThan(1);
    expect(
      tableChunks.every((chunk) =>
        chunk.includes('表格列：奖励 / 概率 / 地区'),
      ),
    ).toBe(true);
    expect(tableChunks.join('\n')).toContain(
      '表格行：奖励=皮肤；概率=10%；地区=东南亚',
    );
  });

  it('preserves empty cells and escaped pipes in configuration tables', async () => {
    const chunker = new MarkdownChunker(500, 50);
    const chunks = await chunker.split(
      [
        '# 多语言素材',
        '| 组件 | 默认文案 | 地区说明 |',
        '| --- | --- | --- |',
        '| 抽奖按钮 |  | 泰语\\|德语预留 30% |',
      ].join('\n'),
    );

    expect(chunks.join('\n')).toContain(
      '表格行：组件=抽奖按钮；默认文案=；地区说明=泰语|德语预留 30%',
    );
  });

  it('labels API, test, and version blocks for game production retrieval', async () => {
    const chunker = new MarkdownChunker(500, 50);
    const chunks = await chunker.split(
      [
        '# 活动交付',
        'POST /api/v1/activity/draw',
        '请求参数：activityId、userId。',
        '',
        '测试用例：重复领取',
        '前置条件：用户已经领取奖励。',
        '预期结果：返回错误码 40003。',
        '',
        '版本：V3',
        '生效地区：东南亚服。',
      ].join('\n'),
    );
    const joined = chunks.join('\n');

    expect(joined).toContain('内容类型：接口契约');
    expect(joined).toContain('内容类型：测试与验收');
    expect(joined).toContain('内容类型：版本与地区规则');
  });
});
