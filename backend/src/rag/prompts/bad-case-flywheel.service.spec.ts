import { BadCaseFlywheelService } from './bad-case-flywheel.service';

describe('BadCaseFlywheelService', () => {
  const createService = () => {
    const client = {
      search: jest.fn(),
      deleteEntities: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
      flushSync: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BadCaseFlywheelService(
      {
        get: jest.fn((key: string) =>
          key === 'agentic.badCaseSimilarityThreshold' ? 0.85 : undefined,
        ),
      } as never,
      { embedQuery: jest.fn().mockResolvedValue([0.1, 0.2]) } as never,
    );
    Object.assign(service, { client, initialized: true });
    return { service, client };
  };

  it('injects at most two reviewed examples above the similarity gate', async () => {
    const { service, client } = createService();
    client.search.mockResolvedValue({
      results: [
        { text: '高相关纠正一', score: 0.96 },
        { text: '高相关纠正二', score: 0.9 },
        { text: '低相关纠正', score: 0.7 },
      ],
    });

    const prompt = await service.selectPrompt('泰语换行规则', 10);

    expect(prompt).toContain('高相关纠正一');
    expect(prompt).toContain('高相关纠正二');
    expect(prompt).not.toContain('低相关纠正');
    expect(prompt).toContain('当前知识库证据');
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2 }),
    );
  });

  it('treats a highly similar but different question as a correction hint, not an exact override', async () => {
    const { service, client } = createService();
    client.search.mockResolvedValue({
      results: [
        {
          id: 'badcase-1',
          query: '泰语活动页换行规则是什么？',
          text: '正确处理标准：按词组断行。',
          score: 0.98,
        },
      ],
    });

    const matches = await service.retrieveMatches('泰语窄屏页面怎么换行？', 1);

    expect(matches).toHaveLength(1);
    expect(matches[0].mode).toBe('correction');
  });

  it('recalls a reviewed Base Case for a same-surname single Chinese name typo', async () => {
    const { service, client } = createService();
    client.search.mockResolvedValue({
      results: [
        {
          id: 'badcase-name-1',
          query: '韦水春是谁',
          text: '正确处理标准：韦水春是临床病理工作人员。',
          score: 0.72,
        },
      ],
    });

    const matches = await service.retrieveMatches('韦永春是谁', 1);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: 'badcase-name-1',
      mode: 'correction',
    });
  });

  it('does not merge different surnames as a Chinese name typo', async () => {
    const { service, client } = createService();
    client.search.mockResolvedValue({
      results: [
        {
          id: 'badcase-name-2',
          query: '李水春是谁',
          text: '正确处理标准：李水春是另一位人员。',
          score: 0.72,
        },
      ],
    });

    await expect(service.retrieveMatches('韦水春是谁', 1)).resolves.toEqual([]);
  });

  it('upserts only the approved correction payload passed by the review gate', async () => {
    const { service, client } = createService();

    const result = await service.indexApproved({
      id: 'feedback-1',
      query: '泰语换行规则',
      wrongAnswer: '按字符强制换行',
      correctedAnswer: '按词组断行并覆盖窄屏验收',
      errorType: 'incomplete_answer',
    });

    expect(result.indexed).toBe(true);
    expect(client.deleteEntities).toHaveBeenCalled();
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: 'badcase_feedback-1',
            text: expect.stringContaining('按词组断行'),
          }),
        ],
      }),
    );
  });

  it('removes a previously indexed bad case when the review is revoked', async () => {
    const { service, client } = createService();

    const result = await service.removeApproved('feedback-1');

    expect(result.removed).toBe(true);
    expect(client.deleteEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        expr: expect.stringContaining('badcase_feedback-1'),
      }),
    );
    expect(client.flushSync).toHaveBeenCalled();
  });
});
