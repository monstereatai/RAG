import { FeishuWikiApiClient } from './feishu-wiki-api.client';

describe('FeishuWikiApiClient', () => {
  const originalFetch = globalThis.fetch;
  const previousAppId = process.env.FEISHU_APP_ID;
  const previousAppSecret = process.env.FEISHU_APP_SECRET;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (previousAppId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = previousAppId;
    if (previousAppSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = previousAppSecret;
  });

  it('gets an app token, pages Wiki nodes, and extracts docx text with that token', async () => {
    process.env.FEISHU_APP_ID = 'test-app-id';
    process.env.FEISHU_APP_SECRET = 'test-app-secret';
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = jest.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        requests.push({ url, init });
        if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
          return jsonResponse({
            code: 0,
            tenant_access_token: 'tenant-token',
            expire: 7200,
          });
        }
        if (url.includes('/wiki/v2/spaces/space-1/nodes')) {
          return jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  node_token: 'node-1',
                  obj_token: 'doc-1',
                  obj_type: 'docx',
                  title: 'Handbook',
                  has_child: false,
                },
              ],
              has_more: false,
            },
          });
        }
        if (url.includes('/docx/v1/documents/doc-1/blocks?')) {
          return jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  block_id: 'block-1',
                  block_type: 2,
                  paragraph: {
                    elements: [{ text_run: { content: 'Feishu content' } }],
                  },
                },
              ],
              has_more: false,
              document_revision_id: 42,
            },
          });
        }
        throw new Error(`Unexpected Feishu API request: ${url}`);
      },
    ) as typeof fetch;

    const client = new FeishuWikiApiClient();
    const nodes = await client.listNodes('space-1');
    const content = await client.getDocumentContent('doc-1');

    expect(nodes).toEqual([
      {
        node_token: 'node-1',
        obj_token: 'doc-1',
        obj_type: 'docx',
        title: 'Handbook',
        has_child: false,
      },
    ]);
    expect(content).toEqual({ text: 'Feishu content', revisionId: '42' });
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.body).toBe(
      JSON.stringify({
        app_id: 'test-app-id',
        app_secret: 'test-app-secret',
      }),
    );
    expect(
      requests
        .slice(1)
        .every(
          ({ init }) =>
            (init?.headers as Record<string, string>).Authorization ===
            'Bearer tenant-token',
        ),
    ).toBe(true);
  });

  it('rejects incomplete node and block page envelopes instead of treating them as empty or complete', async () => {
    process.env.FEISHU_APP_ID = 'test-app-id';
    process.env.FEISHU_APP_SECRET = 'test-app-secret';
    globalThis.fetch = jest.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({
          code: 0,
          tenant_access_token: 'tenant-token',
          expire: 7200,
        });
      }
      if (url.includes('/wiki/v2/spaces/space-1/nodes')) {
        return jsonResponse({ code: 0, data: { has_more: false } });
      }
      if (url.includes('/docx/v1/documents/doc-1/blocks?')) {
        return jsonResponse({ code: 0, data: { items: [] } });
      }
      throw new Error(`Unexpected Feishu API request: ${url}`);
    }) as typeof fetch;

    const client = new FeishuWikiApiClient();
    await expect(client.listNodes('space-1')).rejects.toThrow(
      'Wiki node list returned an invalid page',
    );
    await expect(client.getDocumentContent('doc-1')).rejects.toThrow(
      'document block list returned an invalid page',
    );
  });

  it('rejects malformed Wiki node entries instead of treating them as missing nodes', async () => {
    process.env.FEISHU_APP_ID = 'test-app-id';
    process.env.FEISHU_APP_SECRET = 'test-app-secret';
    globalThis.fetch = jest.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({
          code: 0,
          tenant_access_token: 'tenant-token',
          expire: 7200,
        });
      }
      if (url.includes('/wiki/v2/spaces/space-1/nodes')) {
        return jsonResponse({
          code: 0,
          data: { items: [{ node_token: 'node-1' }], has_more: false },
        });
      }
      throw new Error(`Unexpected Feishu API request: ${url}`);
    }) as typeof fetch;

    await expect(
      new FeishuWikiApiClient().listNodes('space-1'),
    ).rejects.toThrow('Wiki node list contains an invalid node');
  });
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function jsonResponse(payload: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(payload)));
}
