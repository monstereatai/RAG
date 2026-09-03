import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Permission } from '../../database/entities/permission.entity';
import { UserPermission } from '../../database/entities/user-permission.entity';
import { UserService } from '../user/user.service';
import { CreatePermissionDto, UpdatePermissionDto } from './dto/permission.dto';

/** 用户直赋权限条目（含权限详情，便于前端展示） */
export interface UserDirectPermissionItem {
  id: number;
  permissionId: number;
  code: string;
  name: string;
  grantedAt?: Date;
}

@Injectable()
export class PermissionService {
  private permissions: Permission[] = [];
  private nextId = 1;

  /**
   * 内存模式下的「用户直赋权限」表：userId -> permissionId[]
   * 数据库模式下以 user_permissions 表为准。
   */
  private userDirectPermissions = new Map<number, number[]>();

  constructor(
    @Optional()
    @InjectRepository(Permission)
    private readonly permissionRepository?: Repository<Permission>,
    @Optional()
    @InjectRepository(UserPermission)
    private readonly userPermissionRepository?: Repository<UserPermission>,
    // 复用 UserService 做「用户是否存在」校验与角色权限展开（内存/数据库两种模式均可用）
    @Optional()
    private readonly userService?: UserService,
  ) {}

  async create(createPermissionDto: CreatePermissionDto): Promise<Permission> {
    if (!this.permissionRepository) {
      const existing = this.permissions.find(p => p.code === createPermissionDto.code);
      if (existing) {
        throw new ConflictException('Permission code already exists');
      }
      const newPermission = {
        id: this.nextId++,
        ...createPermissionDto,
      } as Permission;
      this.permissions.push(newPermission);
      return newPermission;
    }

    const existing = await this.permissionRepository.findOne({
      where: { code: createPermissionDto.code },
    });

    if (existing) {
      throw new ConflictException('Permission code already exists');
    }

    const permission = this.permissionRepository.create(createPermissionDto);
    return await this.permissionRepository.save(permission);
  }

  async findAll(): Promise<Permission[]> {
    if (!this.permissionRepository) {
      return this.permissions;
    }
    return await this.permissionRepository.find();
  }

  async findOne(id: number): Promise<Permission> {
    if (!this.permissionRepository) {
      const permission = this.permissions.find(p => p.id === Number(id));
      if (!permission) {
        throw new NotFoundException(`Permission with ID ${id} not found`);
      }
      return permission;
    }

    const permission = await this.permissionRepository.findOne({ where: { id } });
    if (!permission) {
      throw new NotFoundException(`Permission with ID ${id} not found`);
    }
    return permission;
  }

  async findByIds(ids: number[]): Promise<Permission[]> {
    if (ids.length === 0) {
      return [];
    }

    if (!this.permissionRepository) {
      return this.permissions.filter(permission => ids.includes(permission.id));
    }

    return this.permissionRepository.find({
      where: ids.map(id => ({ id })),
    });
  }

  async update(id: number, updatePermissionDto: UpdatePermissionDto): Promise<Permission> {
    const permission = await this.findOne(id);
    
    if (updatePermissionDto.code && updatePermissionDto.code !== permission.code) {
      if (!this.permissionRepository) {
        const existing = this.permissions.find(p => p.code === updatePermissionDto.code);
        if (existing) {
          throw new ConflictException('Permission code already exists');
        }
      } else {
        const existing = await this.permissionRepository.findOne({
          where: { code: updatePermissionDto.code },
        });
        if (existing) {
          throw new ConflictException('Permission code already exists');
        }
      }
    }

    Object.assign(permission, updatePermissionDto);

    if (!this.permissionRepository) {
      return permission;
    }

    return await this.permissionRepository.save(permission);
  }

  async remove(id: number): Promise<void> {
    if (!this.permissionRepository) {
      await this.findOne(id); // To check if it exists
      this.permissions = this.permissions.filter(p => p.id !== Number(id));
      return;
    }

    const permission = await this.findOne(id);
    await this.permissionRepository.remove(permission);
  }

  // ==========================================================================
  // 用户直接赋权（User Direct Permissions）
  //
  // 传统 RBAC 只能通过「用户 -> 角色 -> 权限」间接授权；本节引入
  // user_permissions 表实现「用户 -> 权限」的直接授权，用于满足
  // 临时提权、个别用户微调等角色模型覆盖不了的场景。
  // ==========================================================================

  /**
   * 【核心】解析用户的有效权限码集合。
   *
   * 有效权限 = 角色权限 ∪ 用户直赋权限（并集去重）
   *
   * 链路说明：
   *   1. 角色权限：users -> user_roles -> roles -> role_permissions -> permissions.code
   *      （复用 UserService.findOne，其已加载 roles + roles.permissions 关联）
   *   2. 用户直赋权限：user_permissions -> permissions.code
   *
   * 登录（AuthService.login）与刷新令牌（AuthService.refreshToken）都会调用本方法
   * 把并集写入 JWT payload.permissions，PermissionsGuard 依旧只对 JWT 中的
   * permissions 列表做包含性校验 —— Guard 语义不变；超管旁路也保持现状
   * （超管不额外豁免，其权限完全由该并集决定，与改造前一致）。
   */
  async resolveUserPermissionCodes(userId: number): Promise<string[]> {
    // ---- 1) 角色权限链路 ----
    let roleCodes: string[] = [];
    const user = await this.userService?.findOne(Number(userId));
    if (user?.roles) {
      roleCodes = user.roles.flatMap(role => role.permissions?.map(permission => permission.code) ?? []);
    }
    // 内存模式下管理员用户带有扁平 permissions 字段（历史约定），同样并入并集
    const flatCodes: string[] = (user as any)?.permissions ?? [];

    // ---- 2) 用户直赋权限链路 ----
    let directIds: number[] = [];
    if (this.userPermissionRepository) {
      const rows = await this.userPermissionRepository.find({ where: { userId: Number(userId) } });
      directIds = rows.map(row => row.permissionId);
    } else {
      directIds = this.userDirectPermissions.get(Number(userId)) ?? [];
    }
    const directCodes = directIds.length
      ? (await this.findByIds(directIds)).map(permission => permission.code)
      : [];

    // ---- 3) 并集去重：角色权限 ∪ 用户直赋权限 ----
    return Array.from(new Set([...roleCodes, ...flatCodes, ...directCodes]));
  }

  /**
   * 查询某用户的直赋权限列表（带权限 code/name，供前端勾选回显）。
   */
  async listUserDirectPermissions(userId: number): Promise<UserDirectPermissionItem[]> {
    let rows: Array<{ id?: number; permissionId: number; createdAt?: Date }> = [];

    if (this.userPermissionRepository) {
      const found = await this.userPermissionRepository.find({ where: { userId: Number(userId) } });
      rows = found.map(row => ({ id: row.id, permissionId: row.permissionId, createdAt: row.createdAt }));
    } else {
      rows = (this.userDirectPermissions.get(Number(userId)) ?? []).map(permissionId => ({ permissionId }));
    }

    if (rows.length === 0) {
      return [];
    }

    const permissionMap = new Map(
      (await this.findByIds(rows.map(row => row.permissionId))).map(permission => [permission.id, permission]),
    );

    return rows
      .filter(row => permissionMap.has(row.permissionId))
      .map(row => ({
        id: row.id ?? 0,
        permissionId: row.permissionId,
        code: permissionMap.get(row.permissionId)!.code,
        name: permissionMap.get(row.permissionId)!.name,
        grantedAt: row.createdAt,
      }));
  }

  /**
   * 给用户授予直赋权限（幂等：重复授予不会报错，也不会产生重复行）。
   */
  async grantToUser(userId: number, permissionIds: number[]): Promise<UserDirectPermissionItem[]> {
    const user = await this.userService?.findOne(Number(userId));
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // 校验所有权限 ID 真实存在，避免脏数据
    const uniqueIds = Array.from(new Set(permissionIds));
    const permissions = await this.findByIds(uniqueIds);
    if (permissions.length !== uniqueIds.length) {
      throw new BadRequestException('部分权限不存在，无法授权');
    }

    if (!this.userPermissionRepository) {
      const existing = this.userDirectPermissions.get(Number(userId)) ?? [];
      this.userDirectPermissions.set(
        Number(userId),
        Array.from(new Set([...existing, ...uniqueIds])),
      );
      return this.listUserDirectPermissions(userId);
    }

    for (const permissionId of uniqueIds) {
      const exists = await this.userPermissionRepository.findOne({ where: { userId: Number(userId), permissionId } });
      if (!exists) {
        await this.userPermissionRepository.save({ userId: Number(userId), permissionId } as UserPermission);
      }
    }
    return this.listUserDirectPermissions(userId);
  }

  /**
   * 撤销用户的直赋权限（只撤销 user_permissions 中的记录，不影响角色权限）。
   */
  async revokeFromUser(userId: number, permissionIds: number[]): Promise<void> {
    const uniqueIds = Array.from(new Set(permissionIds));

    if (!this.userPermissionRepository) {
      const existing = this.userDirectPermissions.get(Number(userId)) ?? [];
      this.userDirectPermissions.set(
        Number(userId),
        existing.filter(id => !uniqueIds.includes(id)),
      );
      return;
    }

    await this.userPermissionRepository.delete({
      userId: Number(userId),
      permissionId: In(uniqueIds),
    });
  }
}
