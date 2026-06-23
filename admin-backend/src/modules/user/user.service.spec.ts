import { UserService } from './user.service';

/**
 * 在无数据库（内存模式）下测试 UserService 的核心逻辑。
 * userRepository 不注入，服务使用内部 in-memory 数组。
 */
describe('UserService (in-memory mode)', () => {
  let service: UserService;

  beforeEach(() => {
    // 不通过 TestingModule，直接实例化以避免 TypeORM 依赖
    service = new UserService(undefined);
  });

  describe('create', () => {
    it('创建用户后可以用 findAll 找到', async () => {
      await service.create({ username: 'alice', password: 'Password@1', email: 'alice@test.com' });
      const users = await service.findAll();
      expect(users.length).toBe(1);
      expect(users[0].username).toBe('alice');
    });

    it('密码会被 bcrypt 哈希存储，不保存明文', async () => {
      await service.create({ username: 'bob', password: 'Password@1', email: 'bob@test.com' });
      const users = await service.findAll();
      expect(users[0].password).not.toBe('Password@1');
      expect(users[0].password.startsWith('$2')).toBe(true);
    });
  });

  describe('findByUsername', () => {
    it('能按 username 查找用户', async () => {
      await service.create({ username: 'carol', password: 'Password@1', email: 'carol@test.com' });
      const found = await service.findByUsername('carol');
      expect(found).not.toBeNull();
      expect(found!.username).toBe('carol');
    });

    it('用户不存在时返回 null', async () => {
      const found = await service.findByUsername('nobody');
      expect(found).toBeNull();
    });
  });

  describe('validateUser', () => {
    it('正确密码通过验证', async () => {
      await service.create({ username: 'dave', password: 'Password@1', email: 'dave@test.com' });
      const result = await service.validateUser('dave', 'Password@1');
      expect(result).not.toBeNull();
      expect(result!.username).toBe('dave');
    });

    it('错误密码验证失败返回 null', async () => {
      await service.create({ username: 'eve', password: 'Password@1', email: 'eve@test.com' });
      const result = await service.validateUser('eve', 'WrongPassword');
      expect(result).toBeNull();
    });

    it('用户不存在时返回 null', async () => {
      const result = await service.validateUser('ghost', 'Password@1');
      expect(result).toBeNull();
    });
  });

  describe('getPermissionCodes', () => {
    it('能从用户角色中展开权限代码', async () => {
      const user = await service.create({ username: 'grace', password: 'Password@1', email: 'grace@test.com' });
      user.roles = [
        {
          id: 1,
          name: 'Admin',
          code: 'admin',
          description: 'Admin role',
          permissions: [
            { id: 1, name: 'Read role', code: 'admin:role:read', description: 'Read role' },
          ],
        },
      ] as any;

      await expect(service.getPermissionCodes(user.id)).resolves.toEqual(['admin:role:read']);
    });
  });

  describe('remove', () => {
    it('删除后 findAll 不再包含该用户', async () => {
      await service.create({ username: 'frank', password: 'Password@1', email: 'frank@test.com' });
      const users = await service.findAll();
      await service.remove(users[0].id);
      const remaining = await service.findAll();
      expect(remaining.length).toBe(0);
    });
  });
});
