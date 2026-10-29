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
  });
});
