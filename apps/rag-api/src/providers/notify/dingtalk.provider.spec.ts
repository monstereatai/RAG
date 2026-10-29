import { DingTalkProvider } from './dingtalk.provider';
import { createHmac } from 'node:crypto';

function makeConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'dingtalk.webhookUrl':
      'https://oapi.dingtalk.com/robot/send?access_token=test',
    'dingtalk.secret': 'SECtestsecret',
    'dingtalk.alertCooldownMs': 300_000,
    'dingtalk.forwardThreadIds': '',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as never;
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ errcode: 0, errmsg: 'ok' }),
  } as unknown as Response;
}

describe('DingTalkProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reports a safe disabled status and skips smoke without credentials', async () => {
    const provider = new DingTalkProvider(
      makeConfig({
        'dingtalk.webhookUrl': '',
        'dingtalk.secret': '',
      }),
    );
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    expect(provider.getStatus()).toEqual({
      enabled: false,
      alertCooldownMs: 300_000,
      forwardThreadIds: [],
    });
    expect(provider.getHealth()).toEqual({
      enabled: false,
      healthy: false,
      messagesSent: 0,
      lastError: null,
    });
    await expect(provider.smoke()).resolves.toEqual({
      enabled: false,
      sent: false,
      reason: 'dingtalk_disabled_or_missing_keys',
    });
    await provider.notifyApproval({
      threadId: 'thread-1',
      projectId: 'p-1',
      brief: 'brief',
      completedRoles: ['product'],
      pendingApprovalRoles: ['design'],
    });
    await provider.forwardRagAnswer({
      threadId: 'thread-1',
      query: 'q',
      answer: 'a',
      mode: 'auto',
      latencyMs: 100,
      citationCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs with the official DingTalk algorithm (secret as HMAC key)', () => {
    const provider = new DingTalkProvider(makeConfig());
    const sign = (
      provider as unknown as { sign: (ts: number, secret: string) => string }
    ).sign;
    const expected = createHmac('sha256', 'SECtestsecret')
      .update('1700000000000\nSECtestsecret')
      .digest('base64');
    expect(expected).toBe('7LVwF0dAF3/+MRRulbpE4y72Ogzykc6bS2nG4I99T4s=');
    expect(sign(1700000000000, 'SECtestsecret')).toBe(
      encodeURIComponent(expected),
    );
  });

  it('throttles alerts by key within the cooldown window', async () => {
    const provider = new DingTalkProvider(
      makeConfig({ 'dingtalk.alertCooldownMs': 60_000 }),
    );
    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock;

    const first = await provider.notifyAlert('milvus.circuit', 'alert 1');
    const second = await provider.notifyAlert('milvus.circuit', 'alert 2');
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const otherKey = await provider.notifyAlert('retrieval.bm25', 'other');
    expect(otherKey).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends approval notifications without throttling', async () => {
    const provider = new DingTalkProvider(
      makeConfig({ 'dingtalk.alertCooldownMs': 60_000 }),
    );
    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock;

    const payload = {
      threadId: 'thread-1',
      projectId: 'p-1',
      brief: 'brief',
      completedRoles: ['product'],
      pendingApprovalRoles: ['design'],
    };
    await provider.notifyApproval(payload);
    await provider.notifyApproval(payload);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forwards rag answers only for whitelisted thread ids', async () => {
    const provider = new DingTalkProvider(
      makeConfig({ 'dingtalk.forwardThreadIds': ' thread-a , thread-b ' }),
    );
    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock;

    const payload = {
      query: 'q',
      answer: 'a',
      mode: 'auto',
      latencyMs: 100,
      citationCount: 1,
    };
    await provider.forwardRagAnswer({ ...payload, threadId: 'thread-x' });
    expect(fetchMock).not.toHaveBeenCalled();

    await provider.forwardRagAnswer({ ...payload, threadId: 'thread-a' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns and keeps a safe state when the webhook call fails', async () => {
    const provider = new DingTalkProvider(makeConfig());
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ errcode: 0 }),
      });
    global.fetch = fetchMock;

    const sent = await provider.notifyAlert('milvus.circuit', 'alert');
    expect(sent).toBe(false);
    expect(provider.getHealth().messagesSent).toBe(0);
    expect(provider.getHealth().lastError).toContain('network down');

    const recovered = await provider.notifyAlert('retrieval.bm25', 'alert');
    expect(recovered).toBe(true);
    expect(provider.getHealth().messagesSent).toBe(1);
    expect(provider.getHealth().lastError).toBeNull();
  });
});
