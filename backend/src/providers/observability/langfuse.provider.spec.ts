import { LangfuseProvider } from './langfuse.provider';

describe('LangfuseProvider', () => {
  it('reports a safe disabled status and skips smoke without credentials', async () => {
    const provider = new LangfuseProvider({
      get: jest.fn((key: string) => {
        if (key === 'langfuse.baseUrl') return 'http://localhost:3000';
        if (key === 'langfuse.enabled') return false;
        return '';
      }),
    } as never);

    expect(provider.getStatus()).toEqual({
      enabled: false,
      baseUrl: 'http://localhost:3000',
      hasPublicKey: false,
      hasSecretKey: false,
    });
    await expect(provider.smoke()).resolves.toEqual({
      enabled: false,
      sent: false,
      reason: 'langfuse_disabled_or_missing_keys',
    });
    expect(provider.getHealth()).toEqual({
      enabled: false,
      healthy: false,
      lastFlushAt: null,
      tracesSent: 0,
      lastError: null,
    });
  });

  it('does not fail when production workflow tracing is disabled', async () => {
    const provider = new LangfuseProvider({
      get: (key: string) => {
        if (key === 'langfuse.baseUrl') return 'http://localhost:3000';
        if (key === 'langfuse.enabled') return false;
        return undefined;
      },
    } as never);

    await expect(
      provider.traceProductionWorkflow({
        threadId: 'thread-1',
        projectId: 'project-1',
        brief: 'test brief',
        status: 'completed',
        stepCount: 2,
        maxSteps: 18,
        approvalMode: 'auto',
        selectedRoles: ['product'],
        completedRoles: ['product'],
        pendingApprovalRoles: [],
        stages: [],
      }),
    ).resolves.toBeUndefined();
  });
});
