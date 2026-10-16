import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { LessThan, Not } from 'typeorm';
import type { Repository } from 'typeorm';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import {
  FeishuWikiConnectorEntity,
  FeishuWikiItemEntity,
} from '../../providers/db/entities/feishu-wiki-connector.entity';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { DocumentService } from '../document/document.service';
import { DocumentPermissionService } from '../document/document-permission.service';
import {
  FeishuWikiApiClient,
  type FeishuWikiNode,
} from './feishu-wiki-api.client';

const MAX_SYNC_NODES = 10_000;
const STALE_SYNC_TIMEOUT_MS = 24 * 60 * 60_000;

export interface FeishuWikiSyncSummary {
  connectorId: string;
  spaceId: string;
  status: 'idle';
  discovered: number;
  imported: number;
  updated: number;
  unchanged: number;
  skippedUnsupported: number;
  deactivated: number;
  shareWithinTenant: boolean;
}

type SyncPrincipal = Pick<JwtPayload, 'userId' | 'tenantId'>;

@Injectable()
export class FeishuWikiSyncService {
  private readonly logger = new Logger(FeishuWikiSyncService.name);

  constructor(
    @InjectRepository(FeishuWikiConnectorEntity)
    private readonly connectorRepo: Repository<FeishuWikiConnectorEntity>,
    @InjectRepository(FeishuWikiItemEntity)
    private readonly itemRepo: Repository<FeishuWikiItemEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly feishu: FeishuWikiApiClient,
    private readonly documents: DocumentService,
    private readonly permissions: DocumentPermissionService,
  ) {}

  async syncForAdmin(
    ownerUserId: string,
    spaceId: string,
    shareWithinTenant?: boolean,
  ): Promise<FeishuWikiSyncSummary> {
    const principal = await this.resolveAdmin(ownerUserId);
    return this.sync(spaceId, principal, shareWithinTenant);
  }

  async statusForAdmin(ownerUserId: string, spaceId: string) {
    return this.status(spaceId, await this.resolveAdmin(ownerUserId));
  }

  async sync(
    spaceIdInput: string,
    user: SyncPrincipal,
    shareWithinTenant?: boolean,
  ): Promise<FeishuWikiSyncSummary> {
    const spaceId = spaceIdInput.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(spaceId)) {
      throw new BadRequestException('Feishu spaceId is invalid');
    }
    const tenantId = user.tenantId?.trim() || 'legacy';
    this.assertAllowedTenant(tenantId);
    let connector = await this.connectorRepo.findOne({
      where: { tenantId, spaceId },
    });
    if (
      shareWithinTenant !== undefined &&
      typeof shareWithinTenant !== 'boolean'
    ) {
      throw new BadRequestException('shareWithinTenant must be a boolean');
    }
    const desiredSharing =
      shareWithinTenant ?? connector?.shareWithinTenant ?? false;
    if (desiredSharing && !user.tenantId?.trim()) {
      throw new ForbiddenException(
        'tenant context is required for shared Feishu Wiki indexing',
      );
    }
    if (!connector) {
      connector = this.connectorRepo.create({
        id: randomUUID(),
        tenantId,
        ownerUserId: user.userId,
        spaceId,
        status: 'syncing',
        shareWithinTenant: desiredSharing,
        lastSyncAt: null,
        lastError: null,
      });
      try {
        connector = await this.connectorRepo.save(connector);
      } catch (error) {
        const winner = await this.connectorRepo.findOne({
          where: { tenantId, spaceId },
        });
        if (winner)
          throw new ConflictException('Feishu Wiki sync is already running');
        throw error;
      }
    } else if (connector.ownerUserId !== user.userId) {
      throw new ForbiddenException(
        'Feishu Wiki connector belongs to another sync owner',
      );
    } else {
      const claimed = await this.connectorRepo.update(
        [
          { id: connector.id, status: Not('syncing') },
          {
            id: connector.id,
            status: 'syncing',
            updatedAt: LessThan(new Date(Date.now() - STALE_SYNC_TIMEOUT_MS)),
          },
        ],
        { status: 'syncing', lastError: null },
      );
      if (!claimed.affected) {
        throw new ConflictException('Feishu Wiki sync is already running');
      }
      connector.status = 'syncing';
      connector.lastError = null;
    }
    try {
      if (connector.shareWithinTenant && !desiredSharing) {
        await this.revokeTenantSharing(connector, user.userId);
        const updated = await this.connectorRepo.update(
          { id: connector.id, status: 'syncing' },
          { shareWithinTenant: false },
        );
        if (!updated.affected) {
          throw new ConflictException(
            'Feishu Wiki sharing state could not be updated',
          );
        }
        connector.shareWithinTenant = false;
      } else if (!connector.shareWithinTenant && desiredSharing) {
        const updated = await this.connectorRepo.update(
          { id: connector.id, status: 'syncing' },
          { shareWithinTenant: true },
        );
        if (!updated.affected) {
          throw new ConflictException(
            'Feishu Wiki sharing state could not be updated',
          );
        }
        connector.shareWithinTenant = true;
      }
      const summary = await this.syncConnector(connector, user.userId);
      connector.status = 'idle';
      connector.lastSyncAt = new Date();
      connector.lastError = null;
      await this.connectorRepo.save(connector);
      return { ...summary, status: 'idle' };
    } catch (error) {
      connector.status = 'failed';
      connector.lastError = messageOf(error).slice(0, 1000);
      await this.connectorRepo.save(connector);
      throw error;
    }
  }

  async status(spaceIdInput: string, user: SyncPrincipal) {
    const spaceId = spaceIdInput?.trim();
    if (!spaceId || !/^[A-Za-z0-9_-]{1,128}$/.test(spaceId)) {
      throw new BadRequestException('Feishu spaceId is invalid');
    }
    const tenantId = user.tenantId?.trim() || 'legacy';
    this.assertAllowedTenant(tenantId);
    const connector = await this.connectorRepo.findOne({
      where: { tenantId, spaceId },
    });
    if (!connector)
      throw new NotFoundException('Feishu Wiki connector was not found');
    if (connector.ownerUserId !== user.userId) {
      throw new ForbiddenException(
        'Feishu Wiki connector belongs to another sync owner',
      );
    }
    const [activeItems, inactiveItems] = await Promise.all([
      this.itemRepo.count({
        where: { connectorId: connector.id, active: true },
      }),
      this.itemRepo.count({
        where: { connectorId: connector.id, active: false },
      }),
    ]);
    return {
      connectorId: connector.id,
      spaceId: connector.spaceId,
      status: connector.status,
      lastSyncAt: connector.lastSyncAt?.toISOString() ?? null,
      lastError: connector.lastError,
      activeItems,
      inactiveItems,
      shareWithinTenant: connector.shareWithinTenant,
    };
  }

  private async syncConnector(
    connector: FeishuWikiConnectorEntity,
    userId: string,
  ): Promise<Omit<FeishuWikiSyncSummary, 'status'>> {
    const nodes = await this.collectNodes(connector.spaceId);
    const items = await this.itemRepo.find({
      where: { connectorId: connector.id },
    });
    const itemsByNode = new Map(items.map((item) => [item.nodeToken, item]));
    const seenTokens = new Set(nodes.map((node) => node.node_token));
    const seenAt = new Date();
    let imported = 0;
    let updated = 0;
    let unchanged = 0;
    let skippedUnsupported = 0;
    let deactivated = 0;

    for (const listedNode of nodes) {
      let node = listedNode;
      if (!node.obj_type || (node.obj_type === 'docx' && !node.obj_token)) {
        node = await this.feishu.getNode(node.node_token);
      }
      const existing = itemsByNode.get(node.node_token);
      if (node.obj_type !== 'docx' || !node.obj_token) {
        skippedUnsupported += 1;
        if (existing?.active) {
          await this.deactivate(existing, userId);
          deactivated += 1;
        }
        continue;
      }

      const document = await this.feishu.getDocumentContent(node.obj_token);
      const title = (node.title?.trim() || 'Feishu Wiki document').slice(
        0,
        512,
      );
      const content = `# ${title}\n\n${document.text}`;
      const contentHash = createHash('sha256').update(content).digest('hex');
      if (
        existing?.active &&
        existing.contentHash === contentHash &&
        existing.localDocId
      ) {
        existing.title = title;
        existing.objectToken = node.obj_token;
        existing.objectType = node.obj_type;
        existing.remoteRevisionId =
          document.revisionId ?? existing.remoteRevisionId;
        existing.lastSeenAt = seenAt;
        existing.deletedAt = null;
        await this.itemRepo.save(existing);
        await this.applyAccess(existing.localDocId, userId, connector);
        unchanged += 1;
        continue;
      }

      const filename = `${safeFilename(title)}.md`;
      const upload = await this.documents.upload(filename, content, userId, {
        tenantId: connector.tenantId,
        contentType: 'text/markdown',
        businessMetadata: {
          lifecycleStatus: 'effective',
          supersedesDocId: existing?.localDocId ?? null,
          docVersion: document.revisionId ?? contentHash.slice(0, 20),
        },
      });
      const previousDocId = existing?.localDocId;
      const item =
        existing ??
        this.itemRepo.create({
          id: randomUUID(),
          connectorId: connector.id,
          tenantId: connector.tenantId,
          nodeToken: node.node_token,
        });
      const previousItem = existing ? { ...existing } : undefined;
      Object.assign(item, {
        objectToken: node.obj_token,
        objectType: node.obj_type,
        title,
        remoteRevisionId: document.revisionId ?? null,
        contentHash,
        localDocId: upload.docId,
        active: true,
        lastSeenAt: seenAt,
        deletedAt: null,
      });
      const replacementItem = { ...item };
      let itemSaved = false;
      try {
        await this.applyAccess(upload.docId, userId, connector);
        // Move the source pointer first; failed lifecycle transitions can then be compensated.
        await this.itemRepo.save(item);
        itemSaved = true;
        if (previousDocId) {
          const retired = await this.documents.updateLifecycle(
            previousDocId,
            userId,
            'deprecated',
          );
          if (!retired) {
            throw new NotFoundException(
              'Previous Feishu Wiki document could not be retired',
            );
          }
        }
      } catch (error) {
        let keepReplacement = false;
        if (itemSaved && previousItem) {
          Object.assign(item, previousItem);
          try {
            await this.itemRepo.save(item);
          } catch (compensationError) {
            keepReplacement = true;
            const message = messageOf(compensationError).slice(0, 500);
            this.logger.error(
              `Feishu replacement compensation failed; keeping ${upload.docId}: ${message}`,
            );
          }
          if (!keepReplacement && previousDocId) {
            let restored = false;
            try {
              restored = await this.documents.updateLifecycle(
                previousDocId,
                userId,
                'effective',
              );
            } catch (compensationError) {
              this.logger.error(
                `Failed to restore previous Feishu document ${previousDocId}: ${messageOf(compensationError).slice(0, 500)}`,
              );
            }
            if (!restored) {
              Object.assign(item, replacementItem);
              keepReplacement = true;
              try {
                await this.itemRepo.save(item);
              } catch (compensationError) {
                this.logger.error(
                  `Failed to restore Feishu replacement pointer ${upload.docId}: ${messageOf(compensationError).slice(0, 500)}`,
                );
              }
            }
          }
        }
        if (!keepReplacement) {
          try {
            await this.documents.updateLifecycle(
              upload.docId,
              userId,
              'deprecated',
            );
          } catch (compensationError) {
            this.logger.error(
              `Failed to deprecate incomplete Feishu document ${upload.docId}: ${messageOf(compensationError).slice(0, 500)}`,
            );
          }
        }
        throw error;
      }
      if (existing?.localDocId) updated += 1;
      else imported += 1;
    }

    // Deactivation runs only after a complete traversal, so a mid-sync API failure cannot hide documents.
    for (const item of items) {
      if (item.active && !seenTokens.has(item.nodeToken)) {
        await this.deactivate(item, userId);
        deactivated += 1;
      }
    }
    return {
      connectorId: connector.id,
      spaceId: connector.spaceId,
      discovered: nodes.length,
      imported,
      updated,
      unchanged,
      skippedUnsupported,
      deactivated,
      shareWithinTenant: connector.shareWithinTenant,
    };
  }

  /** Revoke tenant-wide ACLs before recording the connector as private or crawling the remote space. */
  private async revokeTenantSharing(
    connector: FeishuWikiConnectorEntity,
    userId: string,
  ): Promise<void> {
    const activeItems = await this.itemRepo.find({
      where: { connectorId: connector.id, active: true },
    });
    for (const item of activeItems) {
      if (!item.localDocId) continue;
      try {
        await this.permissions.setPermissions(item.localDocId, [
          { type: 'user', id: userId },
        ]);
      } catch (error) {
        throw new ServiceUnavailableException(
          `Failed to revoke tenant sharing for Feishu document ${item.localDocId}: ${messageOf(error).slice(0, 500)}`,
        );
      }
    }
  }

  private async collectNodes(spaceId: string): Promise<FeishuWikiNode[]> {
    const firstPage = await this.feishu.listNodes(spaceId);
    const nodes: FeishuWikiNode[] = [];
    const visited = new Set<string>();
    const pending = [...firstPage];
    while (pending.length > 0) {
      const node = pending.shift();
      if (
        !node ||
        typeof node.node_token !== 'string' ||
        !node.node_token.trim() ||
        typeof node.has_child !== 'boolean'
      ) {
        throw new ServiceUnavailableException(
          'Feishu Wiki node list contains an invalid node',
        );
      }
      if (visited.has(node.node_token)) continue;
      visited.add(node.node_token);
      nodes.push(node);
      if (nodes.length > MAX_SYNC_NODES) {
        throw new ConflictException(
          'Feishu Wiki space exceeds the sync node limit',
        );
      }
      if (node.has_child) {
        pending.push(
          ...(await this.feishu.listNodes(spaceId, node.node_token)),
        );
      }
    }
    return nodes;
  }

  private async resolveAdmin(ownerUserId: string): Promise<SyncPrincipal> {
    if (!ownerUserId?.trim())
      throw new BadRequestException('ownerUserId is required');
    const user = await this.userRepo.findOne({
      select: ['id', 'role', 'tenantId'],
      where: { id: ownerUserId.trim() },
    });
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException(
        'Feishu Wiki sync requires a RAG admin user',
      );
    }
    return { userId: user.id, tenantId: user.tenantId ?? undefined };
  }

  private assertAllowedTenant(tenantId: string): void {
    const allowedTenantIds = (
      process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS ?? ''
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!allowedTenantIds.includes(tenantId)) {
      throw new ForbiddenException(
        'RAG tenant is not allowlisted for the configured Feishu application',
      );
    }
  }

  private async deactivate(
    item: FeishuWikiItemEntity,
    userId: string,
  ): Promise<void> {
    if (item.localDocId) {
      await this.permissions.setPermissions(item.localDocId, [
        { type: 'user', id: userId },
      ]);
      const retired = await this.documents.updateLifecycle(
        item.localDocId,
        userId,
        'deprecated',
      );
      if (!retired) {
        throw new NotFoundException(
          'Feishu Wiki document could not be deactivated',
        );
      }
    }
    item.active = false;
    item.deletedAt = new Date();
    await this.itemRepo.save(item);
  }

  private applyAccess(
    docId: string,
    userId: string,
    connector: FeishuWikiConnectorEntity,
  ): Promise<void> {
    return this.permissions.setPermissions(
      docId,
      connector.shareWithinTenant
        ? [{ type: 'public', id: `tenant:${connector.tenantId}` }]
        : [{ type: 'user', id: userId }],
    );
  }
}

function safeFilename(title: string): string {
  const value = [...title]
    .map((character) =>
      /[\\/:*?"<>|]/.test(character) || character.charCodeAt(0) < 32
        ? '_'
        : character,
    )
    .join('')
    .trim()
    .slice(0, 180);
  return value || 'feishu-wiki-document';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Feishu Wiki sync failed';
}
