import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('JwtAuthGuard API Token scopes', () => {
  const context = (
    request: Record<string, unknown>,
    requiredScopes: string[],
  ) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
      requiredScopes,
    }) as never;

  let requiredScopes: string[] | undefined;
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === IS_PUBLIC_KEY ? undefined : requiredScopes,
    ),
  };

  function createGuard(
    payload: Record<string, unknown>,
    requireTenantContext = false,
    enforceIam = false,
    iamService?: { hasPermission: jest.Mock },
    nodeEnv = process.env.NODE_ENV ?? 'test',
  ) {
    return new JwtAuthGuard(
      { verifyToken: jest.fn().mockResolvedValue(payload) } as never,
      { verifyApiToken: jest.fn() } as never,
      { consume: jest.fn() } as never,
      reflector as never,
      {
        get: jest.fn((key: string) => {
          if (key === 'nodeEnv') return nodeEnv;
          if (key === 'auth.requireTenantContext') return requireTenantContext;
          if (key === 'auth.enforceIam') return enforceIam;
          return undefined;
        }),
      } as never,
      iamService as never,
    );
  }

  beforeEach(() => {
    requiredScopes = undefined;
  });

  it('allows an API token with the declared scope', async () => {
    requiredScopes = ['rag:chat'];
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
    requiredScopes = ['rag:documents'];
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
    requiredScopes = ['rag:documents'];
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

  it('requires each declared IAM permission for production user routes', async () => {
    requiredScopes = ['rag:chat', 'rag:documents'];
    const iamService = { hasPermission: jest.fn().mockResolvedValue(true) };
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
        tenantId: 'tenant-a',
      },
      true,
      true,
      iamService,
    );

    await expect(
      guard.canActivate(context(request, ['rag:chat', 'rag:documents'])),
    ).resolves.toBe(true);
    expect(iamService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'rag:chat',
      'tenant-a',
    );
    expect(iamService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'rag:documents',
      'tenant-a',
    );
  });

  it('rejects a production user missing one of the declared IAM permissions', async () => {
    requiredScopes = ['rag:token:manage'];
    const iamService = { hasPermission: jest.fn().mockResolvedValue(false) };
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
        tenantId: 'tenant-a',
      },
      true,
      true,
      iamService,
    );

    await expect(
      guard.canActivate(context(request, ['rag:token:manage'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(iamService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'rag:token:manage',
      'tenant-a',
    );
  });

  it('rejects an explicit IAM disablement in production', () => {
    expect(() =>
      createGuard({}, false, false, undefined, 'production'),
    ).toThrow('AUTH_ENFORCE_IAM=false is not allowed in production');
  });
});
