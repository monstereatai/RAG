import { Injectable, NotFoundException, ConflictException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../../database/entities/permission.entity';
import { CreatePermissionDto, UpdatePermissionDto } from './dto/permission.dto';

@Injectable()
export class PermissionService {
  private permissions: Permission[] = [];
  private nextId = 1;

  constructor(
    @Optional()
    @InjectRepository(Permission)
    private readonly permissionRepository?: Repository<Permission>,
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
}
