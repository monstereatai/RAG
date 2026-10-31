import { resolveRequestTimeoutMs } from './circuit-breaker.interceptor';

describe('resolveRequestTimeoutMs', () => {
  it('allows document operations aggregation to finish its upstream reads', () => {
    expect(
      resolveRequestTimeoutMs(
        '/admin/documents/operations',
        { method: 'GET' },
      ),
    ).toBe(110_000);
  });

  it('gives ticketed previews the coordinated preview timeout', () => {
    expect(
      resolveRequestTimeoutMs(
        '/workflows/:threadId/workspace/preview/:ticket/*',
        { method: 'GET' },
      ),
    ).toBe(90_000);
  });

  it('keeps long workspace operations on their own timeout budgets', () => {
    expect(
      resolveRequestTimeoutMs('/workflows/:threadId/workspace/agent', { method: 'POST' }),
    ).toBe(530_000);
    expect(
      resolveRequestTimeoutMs('/workflows/:threadId/workspace/command', { method: 'POST' }),
    ).toBe(270_000);
    expect(
      resolveRequestTimeoutMs('/workflows/:threadId/workspace/start', { method: 'POST' }),
    ).toBe(180_000);
    expect(
      resolveRequestTimeoutMs('/workflows/:threadId/workspace/export', { method: 'POST' }),
    ).toBe(180_000);
  });

  it('does not apply the preview timeout to ticket creation', () => {
    expect(
      resolveRequestTimeoutMs('/workflows/:threadId/workspace/preview-ticket', {
        method: 'POST',
      }),
    ).toBe(30_000);
  });
});
