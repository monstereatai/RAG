import { ConfigService } from '@nestjs/config';
import { BochaSearchService } from './bocha-search.service';

describe('BochaSearchService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('is disabled and returns empty results when api key is missing', async () => {
    const service = new BochaSearchService({
      get: jest.fn().mockReturnValue(''),
    } as unknown as ConfigService);
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await expect(service.search('LangChain')).resolves.toEqual([]);

    expect(service.isEnabled()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps valid web page results', async () => {
    const service = new BochaSearchService({
      get: jest.fn().mockReturnValue('test-key'),
    } as unknown as ConfigService);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            webPages: {
              value: [
                {
                  name: 'Example',
                  url: 'https://example.com',
                  snippet: 'Snippet',
                  summary: 'Summary',
                  siteName: 'example.com',
                  datePublished: '2026-06-19',
                },
                {
                  name: 'Missing URL',
                  snippet: 'Skipped',
                },
              ],
            },
          },
        }),
    });

    await expect(service.search('query', 3)).resolves.toEqual([
      {
        title: 'Example',
        url: 'https://example.com',
        snippet: 'Snippet',
        summary: 'Summary',
        siteName: 'example.com',
        datePublished: '2026-06-19',
      },
    ]);
  });

  it('throws a clear error when the web search service is unavailable', async () => {
    const service = new BochaSearchService({
      get: jest.fn().mockReturnValue('test-key'),
    } as unknown as ConfigService);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('service unavailable'),
    });

    await expect(service.search('query')).rejects.toThrow(
      'Bocha web_search failed: 503 service unavailable',
    );
  });

  it('combines caller cancellation with the outbound timeout', async () => {
    const service = new BochaSearchService({
      get: jest.fn().mockReturnValue('test-key'),
    } as unknown as ConfigService);
    const controller = new AbortController();
    controller.abort();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { webPages: { value: [] } } }),
    });
    global.fetch = fetchMock;

    await service.search('query', 3, controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toEqual(
      expect.objectContaining({ aborted: true }),
    );
  });
});
