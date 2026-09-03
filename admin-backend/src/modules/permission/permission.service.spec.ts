import { PermissionService } from './permission.service';
import { UserService } from '../user/user.service';

/**
 * 在无数据库（内存模式）下验证权限解析核心语义：
 * 有效权限 = 角色权限 ∪ 用户直赋权限（并集去重）。
 */
describe('PermissionService (in-memory mode)', () => {
  let service: PermissionService;
  let userService: UserService;

  beforeEach(async () => {
    userService = new UserService(undefined);
    service = new PermissionService(undefined, undefined, userService);
  });

  async function createUserWithRolePermission() {
    const user = await userService.create({
      username: 'alice',
      password: 'Password@1',
      email: 'alice@test.com',
    });
    user.roles = [
      {
        id: 1,
        name: 'Ops',
        code: 'ops',
        description: 'Ops role',
        permissions: [
          { id: 11, name: '读文档', code: 'admin:documents:read', description: '' },
        ],
      },
    ] as any;
    return user;
  }

  it('只有角色权限时，有效权限等于角色权限', async () => {
    const user = await createUserWithRolePermission();
    await expect(service.resolveUserPermissionCodes(user.id)).resolves.toEqual([
      'admin:documents:read',
    ]);
  });

  it('直赋权限会并入有效权限（并集）', async () => {
    const user = await createUserWithRolePermission();
    const permission = await service.create({ name: '读审计', code: 'admin:audit:read' });

    await service.grantToUser(user.id, [permission.id]);

    const codes = await service.resolveUserPermissionCodes(user.id);
    expect(codes.sort()).toEqual(['admin:audit:read', 'admin:documents:read']);
  });

  it('并集去重：角色已有该权限时直赋不产生重复', async () => {
    const user = await createUserWithRolePermission();
    const permission = await service.create({ name: '读文档', code: 'admin:documents:read' });

    await service.grantToUser(user.id, [permission.id]);

    await expect(service.resolveUserPermissionCodes(user.id)).resolves.toEqual([
      'admin:documents:read',
    ]);
  });

  it('撤销直赋权限后，只回落到角色权限', async () => {
    const user = await createUserWithRolePermission();
    const permission = await service.create({ name: '读审计', code: 'admin:audit:read' });
    await service.grantToUser(user.id, [permission.id]);

    await service.revokeFromUser(user.id, [permission.id]);

    await expect(service.resolveUserPermissionCodes(user.id)).resolves.toEqual([
      'admin:documents:read',
    ]);
  });

  it('grantToUser 校验用户存在', async () => {
    const permission = await service.create({ name: '读审计', code: 'admin:audit:read' });
    await expect(service.grantToUser(9999, [permission.id])).rejects.toThrow(/not found/);
  });

  it('grantToUser 校验权限存在', async () => {
    const user = await createUserWithRolePermission();
    await expect(service.grantToUser(user.id, [9999])).rejects.toThrow(/权限不存在/);
  });

  it('listUserDirectPermissions 只返回直赋条目（带 code/name）', async () => {
    const user = await createUserWithRolePermission();
    const permission = await service.create({ name: '读审计', code: 'admin:audit:read' });
    await service.grantToUser(user.id, [permission.id]);

    const list = await service.listUserDirectPermissions(user.id);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ permissionId: permission.id, code: 'admin:audit:read' });
  });
});
