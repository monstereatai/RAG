import { ScheduledAnalysisService } from './scheduled-analysis.service';

describe('ScheduledAnalysisService', () => {
  const createService = () =>
    new ScheduledAnalysisService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        traceScheduledAnalysis: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

  it('parses a daily natural-language rule analysis task', () => {
    const result = createService().parseDefinition(
      '每天 10 点统计今天最新的规则，给产品、测试和运营部建议',
      'natural_language',
    );

    expect(result.type).toBe('cron');
    expect(result.cron).toBe('0 10 * * *');
    expect(result.analysisConfig.dataScopes).toContain('rules');
    expect(result.analysisConfig.roles).toEqual(
      expect.arrayContaining(['产品', '测试', '运营']),
    );
    expect(result.analysisConfig.departments).toContain('运营部');
  });

  it('parses a monthly complaint markdown task', () => {
    const result = createService().parseDefinition(
      '# 月度客户投诉复盘\n\n每月 1 号 9 点统计本月客户投诉和问答质量，给客服部建议。',
      'markdown',
    );

    expect(result.name).toBe('月度客户投诉复盘');
    expect(result.cron).toBe('0 9 1 * *');
    expect(result.analysisConfig.window).toBe('month');
    expect(result.analysisConfig.dataScopes).toEqual(
      expect.arrayContaining(['complaints', 'qa']),
    );
  });

  it('converts Chinese meridiem and half-hour expressions', () => {
    const result = createService().parseDefinition(
      '每天晚上 8 点半统计问答质量',
      'natural_language',
    );

    expect(result.cron).toBe('30 20 * * *');
  });

  it('supports interval and workday schedules', () => {
    const service = createService();

    expect(
      service.parseDefinition('每隔 2 小时统计问答质量', 'natural_language'),
    ).toMatchObject({ type: 'every', everyMs: 7_200_000 });
    expect(
      service.parseDefinition(
        '每个工作日早上 9 点统计规则',
        'natural_language',
      ),
    ).toMatchObject({ type: 'cron', cron: '0 9 * * 1-5' });
  });

  it('rejects ambiguous schedules instead of silently creating a daily job', () => {
    expect(() =>
      createService().parseDefinition('分析一下问答数据', 'natural_language'),
    ).toThrow('未识别到明确的执行时间');
  });

  it('rejects generated claims that are not present in the snapshot', () => {
    const service = createService() as unknown as {
      isGroundedGenerated: (text: string, snapshot: unknown) => boolean;
    };
    const snapshot = {
      period: {
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T01:00:00.000Z',
        window: 'today',
      },
      qa: {
        totalQueries: 8,
        refused: 2,
        zeroCitation: 4,
        averageLatencyMs: 4133,
      },
    };

    expect(
      service.isGroundedGenerated(
        '问答共 8 次，建议抽查零引用回答。',
        snapshot,
      ),
    ).toBe(true);
    expect(
      service.isGroundedGenerated(
        '系统版本 v3.2.1，要求 2 小时内处理。',
        snapshot,
      ),
    ).toBe(false);
  });
});
