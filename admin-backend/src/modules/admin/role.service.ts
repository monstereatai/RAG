import { Injectable, NotFoundException, ConflictException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../database/entities/role.entity';
import { Permission } from '../../database/entities/permission.entity';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/role.dto';
import { PermissionService } from '../permission/permission.service';

@Injectable()
export class RoleService {
  private roles: Role[] = [];
  private nextId = 1;

  constructor(
    private readonly permissionService: PermissionService,
    @Optional()
    @InjectRepository(Role)
    private readonly roleRepository?: Repository<Role>,
  ) {}

  async create(createRoleDto: CreateRoleDto): Promise<Role> {
    if (!this.roleRepository) {
      const existing = this.roles.find(r => r.code === createRoleDto.code);
      if (existing) {
        throw new ConflictException('Role code already exists');
      }
      const newRole = {
        id: this.nextId++,
        ...createRoleDto,
        permissions: [],
      } as Role;
      this.roles.push(newRole);
      return newRole;
    }

    const existing = await this.roleRepository.findOne({
      where: { code: createRoleDto.code },
    });
    if (existing) {
      throw new ConflictException('Role code already exists');
    }

    const role = this.roleRepository.create(createRoleDto);
    return await this.roleRepository.save(role);
  }

  async findAll(): Promise<Role[]> {
    if (!this.roleRepository) {
      return this.roles;
    }
    return await this.roleRepository.find({ relations: ['permissions'] });
  }

  async findOne(id: number): Promise<Role> {
    if (!this.roleRepository) {
      const role = this.roles.find(r => r.id === Number(id));
      if (!role) {
        throw new NotFoundException(`Role with ID ${id} not found`);
      }
      return role;
    }

    const role = await this.roleRepository.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    return role;
  }

  async update(id: number, updateRoleDto: UpdateRoleDto): Promise<Role> {
    const role = await this.findOne(id);

    if (updateRoleDto.code && updateRoleDto.code !== role.code) {
      if (!this.roleRepository) {
        const existing = this.roles.find(r => r.code === updateRoleDto.code);
        if (existing) {
          throw new ConflictException('Role code already exists');
        }
      } else {
        const existing = await this.roleRepository.findOne({
          where: { code: updateRoleDto.code },
        });
        if (existing) {
          throw new ConflictException('Role code already exists');
        }
      }
    }

    Object.assign(role, updateRoleDto);

    if (!this.roleRepository) {
      return role;
    }
    return await this.roleRepository.save(role);
  }

  async remove(id: number): Promise<void> {
    if (!this.roleRepository) {
      await this.findOne(id);
      this.roles = this.roles.filter(r => r.id !== Number(id));
      return;
    }

    const role = await this.findOne(id);
    await this.roleRepository.remove(role);
  }

  async assignPermissions(id: number, assignPermissionsDto: AssignPermissionsDto): Promise<Role> {
    const role = await this.findOne(id);
    
    let permissions: Permission[] = [];
    if (assignPermissionsDto.permissionIds && assignPermissionsDto.permissionIds.length > 0) {
      permissions = await this.permissionService.findByIds(assignPermissionsDto.permissionIds);
    }

    role.permissions = permissions;
    
    if (!this.roleRepository) {
      return role;
    }
    return await this.roleRepository.save(role);
  }
}
