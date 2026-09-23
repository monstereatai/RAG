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
                reject(signal.reason);
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
});
