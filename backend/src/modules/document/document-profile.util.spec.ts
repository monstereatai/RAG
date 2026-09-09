import {
  assessIngestionQuality,
  detectGameDocumentMetadata,
  getChunkStrategy,
} from './document-profile.util';
import { MarkdownChunker } from './chunking.util';

describe('game document profile', () => {
  it('detects API metadata and explicit game scope fields', () => {
    const metadata = detectGameDocumentMetadata(
      'draw-api.md',
      [
        '# 抽奖接口文档',
        '项目ID：game-site',
        '活动ID：summer-2026',
        '地区：东南亚',
        '语言：th-TH',
        '渠道：H5',
        '适用角色：前端、后端、测试',
        '状态：已确认',
        'POST /api/v1/activity/draw',
        '请求参数：activityId',
      ].join('\n'),
    );

    expect(metadata).toMatchObject({
      projectId: 'game-site',
      activityId: 'summer-2026',
      region: '东南亚',
      locale: 'th-TH',
      channel: 'H5',
      roleScope: ['前端', '后端', '测试'],
      documentType: 'api',
      lifecycleStatus: 'confirmed',
    });
  });

  it('uses larger chunks and lower overlap for configuration documents', () => {
    expect(getChunkStrategy('config')).toEqual({
      chunkSize: 700,
      chunkOverlap: 105,
    });
  });

  it('reports structure and suspicious parsing quality', async () => {
    const content = [
      '# 配置表',
      '乱码：��������',
      '| 奖励 | 概率 |',
      '| --- | --- |',
      '| 金币 | 50% |',
    ].join('\n');
    const chunks = await new MarkdownChunker(500, 50).splitStructured(content);
    const report = assessIngestionQuality(content, chunks);

    expect(report.accepted).toBe(false);
    expect(report.stats.headings).toBe(1);
    expect(report.stats.tableRows).toBe(3);
    expect(report.warnings).toContain('疑似存在解析乱码');
  });

  it('accepts a structured document without blocking quality issues', async () => {
    const content = [
      '# 夏日活动规则',
      '',
      '## 开放范围',
      '',
      '活动面向已完成实名认证的玩家开放，活动期间每日可参与一次。',
      '',
      '## 奖励规则',
      '',
      '奖励到账后可在游戏内邮件查看，有效期为三十天。',
    ].join('\n');
    const chunks = await new MarkdownChunker(500, 50).splitStructured(content);

    expect(assessIngestionQuality(content, chunks).accepted).toBe(true);
  });
});
