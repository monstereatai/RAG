import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { RedisProvider } from '../../providers/redis/redis.provider';

export interface PermissionSubject {
  type: 'user' | 'role' | 'department' | 'public';
  id: string;
}

@Injectable()
export class DocumentPermissionService {
  /**
   * 文档 ACL（访问控制列表）解析器。有效权限为 public、用户直授、角色、部门和文档所有者的并集；
   * 结果短暂缓存，但每次权限写入都会失效全部 ACL 缓存，优先保证权限收敛正确性。
   */
  constructor(
    @InjectRepository(DocumentPermissionEntity)
    private readonly permissionRepo: Repository<DocumentPermissionEntity>,
    @InjectRepository(DocumentMetaEntity)
    private readonly documentMetaRepo: Repository<DocumentMetaEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly redisProvider: RedisProvider,
  ) {}

  async grantOwner(docId: string, userId: string): Promise<void> {
    await this.setPermissions(docId, [{ type: 'user', id: userId }]);
  }

  /** 用完整授权列表替换旧记录，避免增量写入留下已撤销主体的历史 read 权限。 */
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

  /**
   * 返回当前用户可见文档集合。检索层必须将该集合作为强制过滤条件，
   * 不能仅依赖召回结果中的 userId，以免共享／部门文档出现越权或遗漏。
   */
  async getAllowedDocIds(
    userId: string,
    roles: string[] = [],
    departmentIds: string[] = [],
  ): Promise<Set<string>> {
    const resolvedRoles = await this.resolveRoles(userId, roles);
    const cacheKey = this.cacheKey(userId, resolvedRoles, departmentIds);
    const cached = await this.redisProvider.get(cacheKey);
    if (cached) {
      return new Set(JSON.parse(cached) as string[]);
    }

    const permissions = await this.permissionRepo.find({
      where: [
        { subjectType: 'public', action: 'read' },
        { subjectType: 'user', subjectId: userId, action: 'read' },
        ...(resolvedRoles.length > 0
          ? [
              {
                subjectType: 'role' as const,
                subjectId: In(resolvedRoles),
                action: 'read' as const,
              },
            ]
          : []),
        ...(departmentIds.length > 0
          ? [
              {
                subjectType: 'department' as const,
                subjectId: In(departmentIds),
                action: 'read' as const,
              },
            ]
          : []),
      ],
    });
    const owned = await this.documentMetaRepo.find({
      select: ['docId'],
      where: { userId },
    });
    const ids = [
      ...new Set([
        ...permissions.map((item) => item.docId),
        ...owned.map((item) => item.docId),
      ]),
    ];
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

  private async resolveRoles(
    userId: string,
    roles: string[],
  ): Promise<string[]> {
    if (roles.length > 0) return [...new Set(roles)].sort();
    const user = await this.userRepo.findOne({
      select: ['role'],
      where: { id: userId },
    });
    return user?.role ? [user.role] : [];
  }

  private cacheKey(
    userId: string,
    roles: string[],
    departmentIds: string[],
  ): string {
    return `doc-acl:${userId}:${roles.sort().join(',')}:${departmentIds.sort().join(',')}`;
  }

  private async invalidateAllPermissionCache(): Promise<void> {
    const keys = await this.redisProvider.keys('doc-acl:*');
    await Promise.all(keys.map((key) => this.redisProvider.del(key)));
  }
}
