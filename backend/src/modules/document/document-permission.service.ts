import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { RedisProvider } from '../../providers/redis/redis.provider';

export interface PermissionSubject {
  type: 'user' | 'role' | 'department' | 'public';
  id: string;
}

@Injectable()
export class DocumentPermissionService {
  constructor(
    @InjectRepository(DocumentPermissionEntity)
    private readonly permissionRepo: Repository<DocumentPermissionEntity>,
    private readonly redisProvider: RedisProvider,
  ) {}

  async grantOwner(docId: string, userId: string): Promise<void> {
    await this.setPermissions(docId, [{ type: 'user', id: userId }]);
  }

  async setPermissions(
    docId: string,
    subjects: PermissionSubject[],
  ): Promise<void> {
    await this.permissionRepo.delete({ docId });
    if (subjects.length === 0) {
      await this.invalidateAllPermissionCache();
      return;
    }

    await this.permissionRepo.save(
      subjects.map((subject) =>
        this.permissionRepo.create({
          id: randomUUID(),
          docId,
          subjectType: subject.type,
          subjectId: subject.id,
          action: 'read',
        }),
      ),
    );
    await this.invalidateAllPermissionCache();
  }

  async getAllowedDocIds(
    userId: string,
    roles: string[] = [],
  ): Promise<Set<string>> {
    const cacheKey = this.cacheKey(userId, roles);
    const cached = await this.redisProvider.get(cacheKey);
    if (cached) {
      return new Set(JSON.parse(cached) as string[]);
    }

    const permissions = await this.permissionRepo.find({
      where: [
        { subjectType: 'public', action: 'read' },
        { subjectType: 'user', subjectId: userId, action: 'read' },
        ...(roles.length > 0
          ? [
              {
                subjectType: 'role' as const,
                subjectId: In(roles),
                action: 'read' as const,
              },
            ]
          : []),
      ],
    });
    const ids = [...new Set(permissions.map((item) => item.docId))];
    await this.redisProvider.set(cacheKey, JSON.stringify(ids), 300);
    return new Set(ids);
  }

  async canRead(
    docId: string,
    userId: string,
    roles: string[] = [],
  ): Promise<boolean> {
    const allowed = await this.getAllowedDocIds(userId, roles);
    return allowed.has(docId);
  }

  private cacheKey(userId: string, roles: string[]): string {
    return `doc-acl:${userId}:${roles.sort().join(',')}`;
  }

  private async invalidateAllPermissionCache(): Promise<void> {
    const keys = await this.redisProvider.keys('doc-acl:*');
    await Promise.all(keys.map((key) => this.redisProvider.del(key)));
  }
}
