import { SupervisorService } from './supervisor.service';

describe('SupervisorService cancellation', () => {
  it('returns on caller cancellation and aborts the active agent pipeline', async () => {
    const controller = new AbortController();
    let pipelineAborted = false;
    const pipeline = {
      runPartial: jest.fn(
        (
          _task: string,
          _agents: string[],
          _options: unknown,
          signal: AbortSignal,
        ) =>
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                pipelineAborted = true;
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('pipeline aborted'),
                );
              },
              { once: true },
            );
          }),
      ),
    };
    const service = new SupervisorService(
      {} as never,
      pipeline as never,
      { get: jest.fn().mockReturnValue(30_000) } as never,
    );

    const result = service.query('代码和数据库架构', controller.signal);
    setTimeout(() => controller.abort(new Error('caller cancelled')), 10);

    await expect(result).rejects.toThrow('caller cancelled');
    expect(pipelineAborted).toBe(true);
  });

  it('returns hashes for the actual routing and agent prompts', async () => {
    const structuredInvoke = jest
      .fn()
      .mockResolvedValue({ domain: 'tech', reason: 'test classification' });
    const model = {
      withStructuredOutput: jest.fn(() => ({ invoke: structuredInvoke })),
    };
    const pipeline = {
      runPartial: jest.fn().mockResolvedValue({
        finalOutput: 'answer',
        overallConfidence: 0.9,
        stages: [
          {
            agent: 'writer',
            durationMs: 10,
            confidence: 0.9,
            promptVersion: 'sha256:writer-version',
          },
        ],
      }),
    };
    const service = new SupervisorService(
      { getModel: jest.fn(() => model) } as never,
      pipeline as never,
      { get: jest.fn().mockReturnValue(30_000) } as never,
    );

    const result = await service.query('请分析生态系统的演变规律');

    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(result.routingPromptVersion).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(result.stages).toEqual([
      {
        agent: 'writer',
        durationMs: 10,
        confidence: 0.9,
        promptVersion: 'sha256:writer-version',
      },
    ]);
  });
});
