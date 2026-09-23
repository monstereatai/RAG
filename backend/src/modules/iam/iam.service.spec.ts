import { API_SCOPE_CODES } from '../../common/decorators/api-scopes.decorator';
import { IamService } from './iam.service';

describe('IamService', () => {
  it('does not return permissions for a suspended tenant', async () => {
    const tenants = {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 'tenant-a', status: 'suspended' }),
    };
    const memberships = { findOneBy: jest.fn() };
    const service = new IamService(
      tenants as never,
      memberships as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.hasPermission('user-a', 'platform.read', 'tenant-a'),
    ).resolves.toBe(false);
    expect(memberships.findOneBy).not.toHaveBeenCalled();
  });

  it('seeds explicit API permissions for admin and a limited set for reader', async () => {
    const tenant = { id: 'tenant-a', status: 'active' };
    const roles = [
      { id: 'reader-role', tenantId: 'tenant-a', name: 'reader' },
      { id: 'admin-role', tenantId: 'tenant-a', name: 'admin' },
    ];
    const permissionRows = new Map<string, { id: string; code: string }>();
    const rolePermissionRows = new Set<string>();
    const tenants = {
      findOneBy: jest.fn().mockResolvedValue(tenant),
    };
    const memberships = {};
    const findRoleByName = ({ name }: { name: string }) =>
      Promise.resolve(roles.find((role) => role.name === name) ?? null);
    const roleRepository = {
      findOneBy: jest.fn(findRoleByName),
    };
    const findPermissionByCode = ({ code }: { code: string }) =>
      Promise.resolve(permissionRows.get(code) ?? null);
    const permissions = {
      findOneBy: jest.fn(findPermissionByCode),
      create: jest.fn((value: { id: string; code: string }) => value),
      save: jest.fn((value: { id: string; code: string }) => {
        permissionRows.set(value.code, value);
        return Promise.resolve(value);
      }),
    };
    const membershipRoles = {};
    const findRolePermission = ({
      roleId,
      permissionId,
    }: {
      roleId: string;
      permissionId: string;
    }) =>
      Promise.resolve(
        rolePermissionRows.has(`${roleId}:${permissionId}`)
          ? { roleId, permissionId }
          : null,
      );
    const rolePermissions = {
      findOneBy: jest.fn(findRolePermission),
      create: jest.fn(
        (value: { roleId: string; permissionId: string }) => value,
      ),
      save: jest.fn((value: { roleId: string; permissionId: string }) => {
        rolePermissionRows.add(`${value.roleId}:${value.permissionId}`);
        return Promise.resolve(value);
      }),
    };
    const service = new IamService(
      tenants as never,
      memberships as never,
      roleRepository as never,
      permissions as never,
      membershipRoles as never,
      rolePermissions as never,
    );

    await service.ensureTenant('tenant-a');

    const readerCodes = [...rolePermissionRows]
      .filter((value) => value.startsWith('reader-role:'))
      .map((value) => value.split(':').slice(1).join(':'));
    const adminCodes = [...rolePermissionRows]
      .filter((value) => value.startsWith('admin-role:'))
      .map((value) => value.split(':').slice(1).join(':'));

    expect(adminCodes).toHaveLength(API_SCOPE_CODES.length + 1);
    expect(readerCodes).toContain(permissionRows.get('rag:chat')?.id);
    expect(readerCodes).not.toContain(
      permissionRows.get('rag:token:manage')?.id,
    );
    expect(readerCodes).not.toContain(
      permissionRows.get('rag:observability')?.id,
    );
  });
});
