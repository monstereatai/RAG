/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Mem0Provider } from './mem0.provider';

// Mock MemoryClient
jest.mock('mem0ai', () => {
  return {
    MemoryClient: jest.fn().mockImplementation(() => {
      return {
        search: jest.fn().mockResolvedValue({
          results: [
            { id: '1', memory: 'User is a software engineer', score: 0.95 },
          ],
        }),
        add: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        getAll: jest.fn().mockResolvedValue({
          results: [
            { id: '1', memory: 'User is a software engineer', score: 0.95 },
          ],
        }),
        deleteAll: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe('Mem0Provider', () => {
  let provider: Mem0Provider;
  let mockConfigService: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    };
  });

  describe('disabled mode', () => {
    it('should be disabled when mem0.enabled is false', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return false;
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      expect(provider.isEnabled()).toBe(false);
    });
  });

  describe('cloud mode', () => {
    it('should initialize successfully with apiKey', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      expect(provider.isEnabled()).toBe(true);
    });

    it('should stay disabled in cloud mode if apiKey is missing', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return '';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      expect(provider.isEnabled()).toBe(false);
    });

    it('should successfully search in cloud mode', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      const res = await provider.search({ query: 'hello', userId: 'user-1' });
      expect(res).toEqual([
        {
          id: '1',
          memory: 'User is a software engineer',
          score: 0.95,
          metadata: undefined,
        },
      ]);
    });

    it('should list every cloud memory page with the user and run filters', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      const cloudClient = (
        provider as unknown as { cloudClient: { getAll: jest.Mock } }
      ).cloudClient;
      cloudClient.getAll
        .mockReset()
        .mockResolvedValueOnce({
          count: 51,
          next: 'https://api.mem0.ai/v3/memories/?page=2&page_size=50',
          results: [{ id: 'memory-1', memory: 'First page' }],
        })
        .mockResolvedValueOnce({
          count: 51,
          next: null,
          results: [{ id: 'memory-51', memory: 'Second page' }],
        });

      const memories = await provider.getAll('user-1', 'run-1');

      expect(memories.map(({ id }) => id)).toEqual(['memory-1', 'memory-51']);
      expect(cloudClient.getAll).toHaveBeenNthCalledWith(1, {
        filters: { AND: [{ user_id: 'user-1' }, { run_id: 'run-1' }] },
        page: 1,
        pageSize: 50,
        latestOnly: true,
      });
      expect(cloudClient.getAll).toHaveBeenNthCalledWith(2, {
        filters: { AND: [{ user_id: 'user-1' }, { run_id: 'run-1' }] },
        page: 2,
        pageSize: 50,
        latestOnly: true,
      });
    });

    it('can include superseded memories when listing all cloud pages', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      const cloudClient = (
        provider as unknown as { cloudClient: { getAll: jest.Mock } }
      ).cloudClient;
      cloudClient.getAll
        .mockReset()
        .mockResolvedValueOnce({ count: 1, next: null, results: [] });

      await provider.getAll('user-1', undefined, false);

      expect(cloudClient.getAll).toHaveBeenCalledWith({
        filters: { user_id: 'user-1' },
        page: 1,
        pageSize: 50,
        latestOnly: false,
      });
    });

    it('can rethrow list failures for persistence deduplication checks', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      const cloudClient = (
        provider as unknown as { cloudClient: { getAll: jest.Mock } }
      ).cloudClient;
      cloudClient.getAll.mockRejectedValueOnce(new Error('Mem0 unavailable'));

      await expect(
        provider.getAll('user-1', undefined, false, true),
      ).rejects.toThrow('Mem0 unavailable');
    });

    it('should successfully add memory in cloud mode', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      await expect(
        provider.add({
          messages: [{ role: 'user', content: 'hello' }],
          userId: 'user-1',
        }),
      ).resolves.not.toThrow();
    });

    it('should preserve infer=false for verbatim consolidation memories', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      const cloudClient = (
        provider as unknown as { cloudClient: { add: jest.Mock } }
      ).cloudClient;
      const messages = [{ role: 'user' as const, content: 'Reviewed summary' }];
      await provider.add({ messages, userId: 'user-1', infer: false });

      expect(cloudClient.add).toHaveBeenCalledWith(messages, {
        userId: 'user-1',
        infer: false,
      });
    });

    it('should update memory metadata in cloud mode', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      await expect(
        provider.updateMetadata('memory-1', {
          rag_superseded_at: '2026-10-31',
        }),
      ).resolves.toBeUndefined();
      expect(
        (
          provider as unknown as {
            cloudClient: { update: jest.Mock };
          }
        ).cloudClient.update,
      ).toHaveBeenCalledWith('memory-1', {
        metadata: { rag_superseded_at: '2026-10-31' },
      });
    });

    it('should successfully delete all memory in cloud mode', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'cloud';
          if (key === 'mem0.apiKey') return 'test-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      await expect(provider.deleteAll('user-1')).resolves.not.toThrow();
    });
  });

  describe('local mode', () => {
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      fetchMock = jest.spyOn(global, 'fetch').mockImplementation();
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    it('should initialize successfully with baseUrl', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'local';
          if (key === 'mem0.baseUrl') return 'http://localhost:8000';
          if (key === 'mem0.apiKey') return 'local-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      expect(provider.isEnabled()).toBe(true);
    });

    it('should stay disabled in local mode if baseUrl is missing', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'local';
          if (key === 'mem0.baseUrl') return '';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      expect(provider.isEnabled()).toBe(false);
    });

    it('should search in local mode via fetch', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'local';
          if (key === 'mem0.baseUrl') return 'http://localhost:8000/';
          if (key === 'mem0.apiKey') return 'local-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();

      const mockResponse = {
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [{ id: 'l1', memory: 'Local memory', score: 0.88 }],
            }),
          ),
      } as any;
      fetchMock.mockResolvedValue(mockResponse);

      const res = await provider.search({ query: 'test', userId: 'u1' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'local-api-key',
          }),
        }),
      );
      expect(res).toEqual([
        { id: 'l1', memory: 'Local memory', score: 0.88, metadata: undefined },
      ]);
    });

    it('should pass infer=false to the self-hosted REST API', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'local';
          if (key === 'mem0.baseUrl') return 'http://localhost:8000/';
          if (key === 'mem0.apiKey') return 'local-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();
      fetchMock.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{}'),
      });

      const messages = [{ role: 'user' as const, content: 'Reviewed summary' }];
      await provider.add({ messages, userId: 'u1', infer: false });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/memories',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            messages,
            user_id: 'u1',
            run_id: undefined,
            infer: false,
          }),
        }),
      );
    });

    it('should update memory metadata through the local REST endpoint', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'local';
          if (key === 'mem0.baseUrl') return 'http://localhost:8000/';
          if (key === 'mem0.apiKey') return 'local-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();
      fetchMock.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{}'),
      });

      await provider.updateMetadata('memory/1', {
        rag_superseded_at: '2026-10-31T00:00:00.000Z',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/memories/memory%2F1',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'local-api-key',
          }),
          body: JSON.stringify({
            metadata: { rag_superseded_at: '2026-10-31T00:00:00.000Z' },
          }),
        }),
      );
    });

    it('preserves the self-hosted run_id scope from top-level memory records', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'mem0.enabled') return true;
          if (key === 'mem0.provider') return 'local';
          if (key === 'mem0.baseUrl') return 'http://localhost:8000/';
          if (key === 'mem0.apiKey') return 'local-api-key';
          return defaultValue;
        },
      );

      provider = new Mem0Provider(mockConfigService);
      provider.onModuleInit();
      fetchMock.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  id: 'session-memory',
                  memory: 'Session only',
                  run_id: 'conversation-1',
                  expiration_date: '2026-10-30',
                },
              ],
            }),
          ),
      });

      await expect(provider.getAll('u1', undefined, false)).resolves.toEqual([
        {
          id: 'session-memory',
          memory: 'Session only',
          score: undefined,
          metadata: {
            run_id: 'conversation-1',
            rag_valid_until: '2026-10-30',
          },
        },
      ]);
    });
  });
});
