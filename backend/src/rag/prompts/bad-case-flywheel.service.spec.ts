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
});
