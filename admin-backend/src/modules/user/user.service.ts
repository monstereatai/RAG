import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService {
  private users: User[] = [];
  private nextId = 1;

  constructor(
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>,
  ) {}

  async findAll(): Promise<User[]> {
    if (!this.userRepository) {
      return this.users;
    }

    return this.userRepository.find();
  }

  async findOne(id: number): Promise<User | null> {
    if (!this.userRepository) {
      return this.users.find(user => user.id === Number(id)) || null;
    }

    return this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'roles.permissions'],
    });
  }

  async findByUsername(
    username: string,
    options: { includePassword?: boolean; includeRoles?: boolean } = {},
  ): Promise<User | null> {
    if (!this.userRepository) {
      return this.users.find(user => user.username === username) || null;
    }

    const query = this.userRepository
      .createQueryBuilder('user')
      .where('user.username = :username', { username });

    if (options.includePassword) {
      query.addSelect('user.password');
    }

    if (options.includeRoles) {
      query
        .leftJoinAndSelect('user.roles', 'role')
        .leftJoinAndSelect('role.permissions', 'permission');
    }

    return query.getOne();
  }

  async create(user: Partial<User>): Promise<User> {
    const now = new Date();

    if (user.password) {
      user.password = await bcrypt.hash(user.password, 10);
    }

    if (!this.userRepository) {
      const newUser = {
        id: this.nextId++,
        username: user.username || '',
        password: user.password || '',
        email: user.email || '',
        role: user.role || 'user',
        isActive: user.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        roles: [],
      } as User;

      this.users.push(newUser);
      return newUser;
    }

    const newUser = this.userRepository.create(user);
    return this.userRepository.save(newUser);
  }

  async update(id: number, user: Partial<User>): Promise<User | null> {
    if (user.password) {
      user.password = await bcrypt.hash(user.password, 10);
    }

    if (!this.userRepository) {
      const existingUser = await this.findOne(id);
      if (!existingUser) {
        return null;
      }

      Object.assign(existingUser, user, { updatedAt: new Date() });
      return existingUser;
    }

    await this.userRepository.update(id, user);
    return this.findOne(id);
  }

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.findByUsername(username, {
      includePassword: true,
      includeRoles: true,
    });
    if (user && await bcrypt.compare(password, user.password)) {
      return user;
    }
    return null;
  }

  async getPermissionCodes(id: number): Promise<string[]> {
    const user = await this.findOne(id);
    if (!user?.roles) {
      return [];
    }

    return user.roles.flatMap(role => role.permissions?.map(permission => permission.code) ?? []);
  }

  async remove(id: number): Promise<void> {
    if (!this.userRepository) {
      this.users = this.users.filter(user => user.id !== Number(id));
      return;
    }

    await this.userRepository.delete(id);
  }
}
