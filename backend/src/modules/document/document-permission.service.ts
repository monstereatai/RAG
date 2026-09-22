import { ForbiddenException, Injectable } from '@nestjs/common';
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

  /** 写入侧也校验租户上下文，避免异步 Worker 被篡改 userId 后跨租户落库。 */
  async assertTenant(
    userId: string,
    requestedTenantId?: string,
  ): Promise<void> {
    const tenantId = requestedTenantId?.trim();
    if (!tenantId) return;
    const principal = await this.userRepo.findOne({
      select: ['tenantId'],
      where: { id: userId },
    });
    const principalTenantId = principal?.tenantId?.trim();
    if (principalTenantId && principalTenantId !== tenantId) {
      throw new ForbiddenException('tenant scope does not match current user');
    }
  }

  /** 用完整授权列表替换旧记录，避免增量写入留下已撤销主体的历史 read 权限。 */
  async setPermissions(
    docId: string,
    subjects: PermissionSubject[],
  ): Promise<void> {
    // ACL 替换必须原子完成，避免“先删旧权限、后写新权限”期间的并发检索
    // 看到空集合。缓存只在事务提交后失效，确保读请求不会拿到半成品状态。
    await this.permissionRepo.manager.transaction(async (manager) => {
      await manager.delete(DocumentPermissionEntity, { docId });
      if (subjects.length > 0) {
        await manager.save(
          DocumentPermissionEntity,
          subjects.map((subject) => ({
            id: randomUUID(),
            docId,
            subjectType: subject.type,
            subjectId: subject.id,
            action: 'read' as const,
          })),
        );
      }
    });
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
    requestedTenantId?: string,
  ): Promise<Set<string>> {
    const principal = await this.userRepo.findOne({
      select: ['role', 'tenantId'],
      where: { id: userId },
    });
    const resolvedRoles = roles.length
      ? [...new Set(roles)].sort()
      : principal?.role
        ? [principal.role]
        : [];
    const principalTenantId = principal?.tenantId?.trim() || undefined;
    const tenantId = requestedTenantId?.trim() || principalTenantId || null;
    if (
      requestedTenantId?.trim() &&
      principalTenantId &&
      requestedTenantId.trim() !== principalTenantId
    ) {
      throw new ForbiddenException('tenant scope does not match current user');
    }
    const cacheKey = this.cacheKey(
      userId,
      resolvedRoles,
      departmentIds,
      tenantId,
    );
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
    const tenantScopedIds = tenantId
      ? await this.filterDocumentsToTenant(ids, tenantId)
      : ids;
    await this.redisProvider.set(
      cacheKey,
      JSON.stringify(tenantScopedIds),
      300,
    );
    return new Set(tenantScopedIds);
  }

  async canRead(
    docId: string,
    userId: string,
    roles: string[] = [],
    requestedTenantId?: string,
  ): Promise<boolean> {
    const allowed = await this.getAllowedDocIds(
      userId,
      roles,
      [],
      requestedTenantId,
    );
    return allowed.has(docId);
  }

  private async filterDocumentsToTenant(
    docIds: string[],
    tenantId: string,
  ): Promise<string[]> {
    if (docIds.length === 0) return [];
    const docs = await this.documentMetaRepo.find({
      select: ['docId', 'userId'],
      where: { docId: In(docIds) },
    });
    const ownerIds = [
      ...new Set(
        docs
          .map((doc) => doc.userId)
          .filter((ownerId): ownerId is string => Boolean(ownerId)),
      ),
    ];
    if (ownerIds.length === 0) return [];
    const tenantOwners = await this.userRepo.find({
      select: ['id'],
      where: { id: In(ownerIds), tenantId },
    });
    const allowedOwners = new Set(tenantOwners.map((user) => user.id));
    return docs
      .filter((doc) => doc.userId && allowedOwners.has(doc.userId))
      .map((doc) => doc.docId);
  }

  private cacheKey(
    userId: string,
    roles: string[],
    departmentIds: string[],
    tenantId: string | null = null,
  ): string {
    return `doc-acl:${tenantId ?? 'legacy'}:${userId}:${roles.sort().join(',')}:${departmentIds.sort().join(',')}`;
  }

  private async invalidateAllPermissionCache(): Promise<void> {
    const redis = this.redisProvider as RedisProvider & {
      scan?: (pattern: string) => Promise<string[]>;
    };
    const keys = redis.scan
      ? await redis.scan('doc-acl:*')
      : await redis.keys('doc-acl:*');
    await Promise.all(keys.map((key) => this.redisProvider.del(key)));
  }
}
