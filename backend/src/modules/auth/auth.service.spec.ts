import { AuthUserRecord, AuthUserStore } from './auth-user.store';
import { AuthService } from './auth.service';

describe('AuthService tenant claims', () => {
  it('uses the legacy tenant in JWT when membership provisioning uses the same fallback', async () => {
    const user: AuthUserRecord = {
      id: 'user-1',
      username: 'reader',
      email: 'reader@example.test',
      passwordHash: AuthUserStore.hashPassword('password-123'),
      role: 'user',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let accessPayload: Record<string, unknown> | undefined;
    const jwtService = {
      signAsync: jest.fn((payload: Record<string, unknown>) => {
        if (payload.type === 'access') accessPayload = payload;
        return Promise.resolve(
          payload.type === 'access' ? 'access' : 'refresh',
        );
      }),
    };
    const configService = {
      get: jest.fn(
        (key: string) =>
          ({
            AUTH_REQUIRE_EMAIL_VERIFIED: 'true',
            JWT_ACCESS_EXPIRES: '2h',
            JWT_REFRESH_EXPIRES: '7d',
            JWT_REFRESH_SECRET: 'refresh-secret',
            JWT_SECRET: 'access-secret',
          })[key],
      ),
    };
    const userStore = {
      findByUsername: jest.fn().mockResolvedValue(user),
    };
    const iamService = { ensureMembership: jest.fn().mockResolvedValue({}) };
    const service = new AuthService(
      jwtService as never,
      configService as never,
      userStore as never,
      {} as never,
      {} as never,
      iamService as never,
    );

    await service.login({ username: 'reader', password: 'password-123' });

    expect(iamService.ensureMembership).toHaveBeenCalledWith(
      'user-1',
      'legacy',
      'reader',
    );
    expect(accessPayload).toMatchObject({
      userId: 'user-1',
      tenantId: 'legacy',
      type: 'access',
    });
  });
});
