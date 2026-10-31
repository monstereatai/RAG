import { AuthIdentitySyncService } from './auth-identity-sync.service';

describe('AuthIdentitySyncService', () => {
  const user = {
    id: 'user-1',
    username: 'reader',
    email: 'reader@example.test',
    passwordHash: 'scrypt:salt:hash',
    role: 'user' as const,
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('inserts the auth user into the PostgreSQL identity table', async () => {
    const repo = {
      findOneBy: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthIdentitySyncService(repo as never);

    await service.sync(user, { required: true });

    expect(repo.insert).toHaveBeenCalledWith({
      id: 'user-1',
      username: 'reader',
      passwordHash: 'scrypt:salt:hash',
      role: 'user',
      tenantId: 'legacy',
    });
  });

  it('updates tenant and password fields for an existing identity row', async () => {
    const repo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'user-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthIdentitySyncService(repo as never);

    await service.sync({ ...user, tenantId: 'tenant-a' }, { required: true });

    expect(repo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({
        username: 'reader',
        tenantId: 'tenant-a',
      }),
    );
  });

  it('fails closed when required and the repository is missing', async () => {
    const service = new AuthIdentitySyncService(undefined);
    await expect(service.sync(user, { required: true })).rejects.toThrow(
      'users repository is unavailable',
    );
  });
});
