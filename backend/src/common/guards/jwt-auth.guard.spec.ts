import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard API Token scopes', () => {
  const context = (
    request: Record<string, unknown>,
    requiredScopes: string[],
  ) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
      requiredScopes,
    }) as never;

  const reflector = {
    getAllAndOverride: jest.fn(() => undefined as string[] | undefined),
  };

  function createGuard(
    payload: Record<string, unknown>,
    requireTenantContext = false,
  ) {
    return new JwtAuthGuard(
      { verifyToken: jest.fn().mockResolvedValue(payload) } as never,
      { verifyApiToken: jest.fn() } as never,
      { consume: jest.fn() } as never,
      reflector as never,
      { get: jest.fn().mockReturnValue(requireTenantContext) } as never,
    );
  }

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
  });

  it('allows an API token with the declared scope', async () => {
    reflector.getAllAndOverride.mockReturnValue(['rag:chat']);
    const request = {
      headers: { authorization: 'Bearer access-token' },
      query: {},
    };
    const guard = createGuard({
      userId: 'user-1',
      username: 'user-1',
      role: 'user',
      authType: 'api-token',
      scopes: ['rag:chat'],
    });

    await expect(
      guard.canActivate(context(request, ['rag:chat'])),
    ).resolves.toBe(true);
  });

  it('rejects an API token without the declared scope', async () => {
    reflector.getAllAndOverride.mockReturnValue(['rag:documents']);
    const request = {
      headers: { authorization: 'Bearer access-token' },
      query: {},
    };
    const guard = createGuard({
      userId: 'user-1',
      username: 'user-1',
      role: 'user',
      authType: 'api-token',
      scopes: ['rag:chat'],
    });

    await expect(
      guard.canActivate(context(request, ['rag:documents'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not restrict a normal JWT with API scope metadata', async () => {
    reflector.getAllAndOverride.mockReturnValue(['rag:documents']);
    const request = {
      headers: { authorization: 'Bearer access-token' },
      query: {},
    };
    const guard = createGuard({
      userId: 'user-1',
      username: 'user-1',
      role: 'user',
      authType: 'jwt',
    });

    await expect(
      guard.canActivate(context(request, ['rag:documents'])),
    ).resolves.toBe(true);
  });

  it('fails closed when production tenant context is required but missing', async () => {
    const request = {
      headers: { authorization: 'Bearer access-token' },
      query: {},
    };
    const guard = createGuard(
      {
        userId: 'user-1',
        username: 'user-1',
        role: 'user',
        authType: 'jwt',
      },
      true,
    );

    await expect(
      guard.canActivate(context(request, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps internal service authentication independent from tenant user context', async () => {
    const request = {
      headers: { authorization: 'Bearer access-token' },
      query: {},
    };
    const guard = createGuard(
      {
        userId: 'service-1',
        username: 'service-1',
        role: 'admin',
        authType: 'service',
      },
      true,
    );

    await expect(guard.canActivate(context(request, []))).resolves.toBe(true);
  });
});
