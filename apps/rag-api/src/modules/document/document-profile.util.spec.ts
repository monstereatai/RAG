import {
  assessIngestionQuality,
  detectGameDocumentMetadata,
  evaluateChunkStrategy,
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
      semanticBoundaries: true,
    });
  });

  it('evaluates semantic boundaries and profile overlap for experiments', async () => {
    const strategy = getChunkStrategy('prd');
    const source =
      '# PRD\n## 规则\n第一条说明活动资格和时间。\n第二条说明奖励和补偿。';
    const chunks = await new MarkdownChunker(
      strategy.chunkSize,
      strategy.chunkOverlap,
    ).splitStructured(source);
    const evaluation = await evaluateChunkStrategy(source, chunks, strategy);
    expect(evaluation.overlapRatio).toBeGreaterThanOrEqual(0.1);
    expect(evaluation.overlapRatio).toBeLessThanOrEqual(0.2);
    expect(evaluation.semanticBoundaryRate).toBeGreaterThan(0);
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

  it('retains parser warnings and blocks incomplete partial results', async () => {
    const content = '# 混合扫描 PDF\n\n'.concat('识别文本。'.repeat(12));
    const chunks = await new MarkdownChunker(500, 50).splitStructured(content);
    const report = assessIngestionQuality(content, chunks, {
      status: 'partial',
      completeness: 0.5,
      warnings: [
        {
          code: 'pdf.page_ocr_empty',
          message: '页面未识别到正文',
          pageNumber: 2,
        },
      ],
    });

    expect(report.accepted).toBe(false);
    expect(report.parseStatus).toBe('partial');
    expect(report.parseWarnings?.[0].pageNumber).toBe(2);
    expect(report.warnings).toContain('文档解析部分完成');
    expect(report.warnings).toContain('解析告警（第 2 页）：页面未识别到正文');
  });

  it('accepts usable partial content above the completeness threshold with warnings', async () => {
    const content = '# 混合扫描 PDF\n\n'.concat(
      'OCR正文保留章节结构。'.repeat(12),
    );
    const chunks = await new MarkdownChunker(500, 50).splitStructured(content);
    const report = assessIngestionQuality(content, chunks, {
      status: 'partial',
      completeness: 0.9,
      warnings: [
        { code: 'pdf.page_ocr_empty', message: '第 8 页为空', pageNumber: 8 },
      ],
    });

    expect(report.accepted).toBe(true);
    expect(report.parseStatus).toBe('partial');
    expect(report.parseCompleteness).toBe(0.9);
    expect(report.warnings).toContain('文档解析部分完成');
  });

  it('never accepts a failed parser result', async () => {
    const content = '# Parsed body\n\n'.concat('x'.repeat(60));
    const chunks = await new MarkdownChunker(500, 50).splitStructured(content);
    const report = assessIngestionQuality(content, chunks, {
      status: 'failed',
      completeness: 0,
      warnings: [{ code: 'office.invalid_package', message: '缺少文档主部件' }],
    });

    expect(report.accepted).toBe(false);
    expect(report.parseStatus).toBe('failed');
  });

  it('does not treat a topic mention of deprecated as a deprecated document', () => {
    const metadata = detectGameDocumentMetadata(
      'api-version-runbook.md',
      [
        '# API 版本下线规则',
        '对外 API 版本标记 deprecated 后，至少保留 9 个月才允许下线。',
      ].join('\n'),
    );

    expect(metadata.lifecycleStatus).toBe('effective');
  });

  it('still honors an explicit lifecycle status field', () => {
    const metadata = detectGameDocumentMetadata(
      'old-policy.md',
      ['# 旧制度', '状态：废弃'].join('\n'),
    );

    expect(metadata.lifecycleStatus).toBe('deprecated');
  });
});
