import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceTokenGuard } from './service-token.guard';

describe('ServiceTokenGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalToken = process.env.RAG_SERVICE_TOKEN;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalToken === undefined) {
      delete process.env.RAG_SERVICE_TOKEN;
    } else {
      process.env.RAG_SERVICE_TOKEN = originalToken;
    }
    jest.restoreAllMocks();
  });

  it('accepts the local dev service token when no token is configured outside production', () => {
    delete process.env.RAG_SERVICE_TOKEN;
    process.env.NODE_ENV = 'development';
    const guard = createGuard();
    const request = {
      headers: { authorization: 'Bearer local-rag-service-token' },
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
    expect(request).toMatchObject({
      user: {
        userId: 'admin-backend',
        username: 'admin-backend',
        role: 'admin',
      },
    });
  });

  it('fails fast in production when no service token is configured', () => {
    delete process.env.RAG_SERVICE_TOKEN;
    process.env.NODE_ENV = 'production';

    expect(() => createGuard()).toThrow(
      'RAG_SERVICE_TOKEN is required when NODE_ENV=production',
    );
  });

  it('accepts the configured service token', () => {
    const guard = createGuard('configured-token');
    const request = {
      headers: { authorization: 'Bearer configured-token' },
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
  });

  it('rejects a valid-looking user JWT instead of treating it as a service identity', async () => {
    const guard = createGuard('configured-token');
    const request = {
      headers: { authorization: 'Bearer user-jwt' },
    };

    expect(() => guard.canActivate(createContext(request))).toThrow(
      'invalid internal service authentication',
    );
  });
});

function createGuard(serviceToken?: string) {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'RAG_SERVICE_TOKEN') return serviceToken;
      if (key === 'nodeEnv') return process.env.NODE_ENV ?? 'development';
      return undefined;
    }),
  } as unknown as ConfigService;

  return new ServiceTokenGuard(configService);
}

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
