import { ToolExecutionService } from './tool-execution.service';

describe('ToolExecutionService', () => {
  const createService = () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const service = new ToolExecutionService(
      { decide: jest.fn().mockReturnValue({ allowed: true, requiresApproval: false }) } as never,
      { emit } as never,
      { isEnabled: () => false, get: jest.fn(), setIfAbsent: jest.fn(), set: jest.fn() } as never,
    );
    return { service, emit };
  };

  it('writes a call event before the immutable result event', async () => {
    const { service, emit } = createService();
    const output = await service.execute({ toolName: 'dashscope_rerank', threadId: 'thread-1', mode: 'simple', execute: async () => ({ ok: true }) });
    expect(output.status).toBe('success');
    expect(emit.mock.calls.map(([event]) => event.eventType)).toEqual(['tool.call', 'tool.result']);
  });

  it('fails closed when a write tool has no approval', async () => {
    const { service } = createService();
    const policy = (service as any).policy;
    policy.decide.mockReturnValue({ allowed: true, requiresApproval: true });
    const output = await service.execute({ toolName: 'artifact_generate', threadId: 'thread-1', mode: 'production', approvalPolicy: 'required', execute: async () => 'not-run' });
    expect(output.status).toBe('blocked');
  });

  it('recovers a completed idempotent write without executing it twice', async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const execute = jest.fn();
    const service = new ToolExecutionService(
      { decide: jest.fn().mockReturnValue({ allowed: true, requiresApproval: false }) } as never,
      { emit } as never,
      { isEnabled: () => true, get: jest.fn().mockResolvedValue('completed:{"id":"artifact-1"}'), setIfAbsent: jest.fn(), set: jest.fn() } as never,
    );
    const result = await service.execute({
      toolName: 'artifact_generate', threadId: 'thread-1', mode: 'production', sideEffect: true,
      idempotencyKey: 'artifact-key', execute,
    });
    expect(result).toMatchObject({ status: 'recovered', output: { id: 'artifact-1' } });
    expect(execute).not.toHaveBeenCalled();
  });
});
