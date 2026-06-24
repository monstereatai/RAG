import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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

  it('does not accept the local dev service token in production when no token is configured', async () => {
    delete process.env.RAG_SERVICE_TOKEN;
    process.env.NODE_ENV = 'production';
    const jwtService = {
      verifyAsync: jest.fn().mockRejectedValue(new Error('bad token')),
    } as unknown as JwtService;
    const guard = createGuard(undefined, jwtService);

    await expect(
      guard.canActivate(
        createContext({
          headers: { authorization: 'Bearer local-rag-service-token' },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses configured service token before JWT verification', () => {
    const verifyAsync = jest.fn();
    const jwtService = {
      verifyAsync,
    } as unknown as JwtService;
    const guard = createGuard('configured-token', jwtService);
    const request = {
      headers: { authorization: 'Bearer configured-token' },
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
  });
});

function createGuard(
  serviceToken?: string,
  jwtService: JwtService = { verifyAsync: jest.fn() } as unknown as JwtService,
) {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'RAG_SERVICE_TOKEN') return serviceToken;
      if (key === 'nodeEnv') return process.env.NODE_ENV ?? 'development';
      return undefined;
    }),
  } as unknown as ConfigService;

  return new ServiceTokenGuard(jwtService, configService);
}

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
