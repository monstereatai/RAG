import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, IsNull, Repository } from 'typeorm';
import { IamTenantEntity } from '../../providers/db/entities/iam-tenant.entity';
import { IamMembershipEntity } from '../../providers/db/entities/iam-membership.entity';
import { IamRoleEntity } from '../../providers/db/entities/iam-role.entity';
import { IamPermissionEntity } from '../../providers/db/entities/iam-permission.entity';
import { IamMembershipRoleEntity } from '../../providers/db/entities/iam-membership-role.entity';
import { IamRolePermissionEntity } from '../../providers/db/entities/iam-role-permission.entity';

@Injectable()
export class IamService {
  constructor(
    @InjectRepository(IamTenantEntity)
    private readonly tenants: Repository<IamTenantEntity>,
    @InjectRepository(IamMembershipEntity)
    private readonly memberships: Repository<IamMembershipEntity>,
    @InjectRepository(IamRoleEntity)
    private readonly roles: Repository<IamRoleEntity>,
    @InjectRepository(IamPermissionEntity)
    private readonly permissions: Repository<IamPermissionEntity>,
    @InjectRepository(IamMembershipRoleEntity)
    private readonly membershipRoles: Repository<IamMembershipRoleEntity>,
    @InjectRepository(IamRolePermissionEntity)
    private readonly rolePermissions: Repository<IamRolePermissionEntity>,
  ) {}

  async ensureTenant(
    tenantId: string,
    name = tenantId,
  ): Promise<IamTenantEntity> {
    const existing = await this.tenants.findOneBy({ id: tenantId });
    let tenant = existing;
    if (!tenant) {
      try {
        tenant = await this.tenants.save(
          this.tenants.create({
            id: tenantId,
            slug: tenantId,
            name,
            status: 'active',
          }),
        );
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        tenant = await this.tenants.findOneBy({ id: tenantId });
        if (!tenant) throw error;
      }
    }

    // 新租户不能因为没有迁移时种子角色而“登录成功但没有权限”。
    // 默认只授予 platform.read，管理员角色也必须显式再绑定其他权限。
    const permission = await this.ensurePermission(
      'platform.read',
      'Read platform resources',
    );
    const reader = await this.ensureRole(
      tenantId,
      'reader',
      'Tenant read-only role',
    );
    await this.ensureRolePermission(reader, permission);
    const admin = await this.ensureRole(
      tenantId,
      'admin',
      'Tenant administrator role',
    );
    await this.ensureRolePermission(admin, permission);
    return tenant;
  }

  async ensureMembership(
    userId: string,
    tenantId = 'legacy',
    defaultRoleName: 'reader' | 'admin' = 'reader',
  ): Promise<IamMembershipEntity> {
    await this.ensureTenant(tenantId);
    const existing = await this.memberships.findOneBy({ tenantId, userId });
    let membership = existing;
    if (!membership) {
      try {
        membership = await this.memberships.save(
          this.memberships.create({
            id: randomUUID(),
            tenantId,
            userId,
            status: 'active',
          }),
        );
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        membership = await this.memberships.findOneBy({ tenantId, userId });
        if (!membership) throw error;
      }
    }
    const defaultRole = await this.roles.findOneBy({
      tenantId,
      name: defaultRoleName,
    });
    if (defaultRole) {
      const binding = await this.membershipRoles.findOneBy({
        membershipId: membership.id,
        roleId: defaultRole.id,
      });
      if (!binding) {
        try {
          await this.membershipRoles.save(
            this.membershipRoles.create({
              membershipId: membership.id,
              roleId: defaultRole.id,
            }),
          );
        } catch (error) {
          if (!this.isUniqueViolation(error)) throw error;
        }
      }
    }
    return membership;
  }

  async listPermissions(
    userId: string,
    tenantId = 'legacy',
  ): Promise<string[]> {
    const membership = await this.memberships.findOneBy({
      tenantId,
      userId,
      status: 'active',
    });
    if (!membership) return [];
    const assignments = await this.membershipRoles.find({
      where: { membershipId: membership.id },
    });
    if (assignments.length === 0) return [];
    const roleIds = assignments.map((assignment) => assignment.roleId);
    const rolePermissions = await this.rolePermissions.find({
      where: { roleId: In(roleIds) },
    });
    if (rolePermissions.length === 0) return [];
    const permissionRows = await this.permissions.find({
      where: { id: In(rolePermissions.map((item) => item.permissionId)) },
    });
    return [...new Set(permissionRows.map((permission) => permission.code))];
  }

  async hasPermission(
    userId: string,
    permission: string,
    tenantId = 'legacy',
  ): Promise<boolean> {
    const permissions = await this.listPermissions(userId, tenantId);
    return permissions.includes(permission) || permissions.includes('*');
  }

  async listRoles(tenantId = 'legacy'): Promise<IamRoleEntity[]> {
    return this.roles.find({
      where: [{ tenantId }, { tenantId: IsNull() }],
      order: { name: 'ASC' },
    });
  }

  private async ensurePermission(
    code: string,
    description: string,
  ): Promise<IamPermissionEntity> {
    const existing = await this.permissions.findOneBy({ code });
    if (existing) return existing;
    try {
      return await this.permissions.save(
        this.permissions.create({
          id: code.replace(/[^a-z0-9-]/gi, '-').slice(0, 64),
          code,
          description,
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const concurrent = await this.permissions.findOneBy({ code });
      if (!concurrent) throw error;
      return concurrent;
    }
  }

  private async ensureRole(
    tenantId: string,
    name: string,
    description: string,
  ): Promise<IamRoleEntity> {
    const existing = await this.roles.findOneBy({ tenantId, name });
    if (existing) return existing;
    try {
      return await this.roles.save(
        this.roles.create({
          id: randomUUID(),
          tenantId,
          name,
          description,
          isSystem: true,
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const concurrent = await this.roles.findOneBy({ tenantId, name });
      if (!concurrent) throw error;
      return concurrent;
    }
  }

  private async ensureRolePermission(
    role: IamRoleEntity,
    permission: IamPermissionEntity,
  ): Promise<void> {
    const existing = await this.rolePermissions.findOneBy({
      roleId: role.id,
      permissionId: permission.id,
    });
    if (existing) return;
    try {
      await this.rolePermissions.save(
        this.rolePermissions.create({
          roleId: role.id,
          permissionId: permission.id,
          grantedAt: new Date(),
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      driverError?: { code?: string };
    };
    const code = candidate?.code ?? candidate?.driverError?.code;
    return (
      code === '23505' ||
      code === 'ER_DUP_ENTRY' ||
      code === 'SQLITE_CONSTRAINT'
    );
  }
}
