import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import { DomainEventOutboxEntity } from '../../providers/db/entities/domain-event-outbox.entity';
import { DomainEventSubscriptionEntity } from '../../providers/db/entities/domain-event-subscription.entity';
import { DomainEventDeliveryEntity } from '../../providers/db/entities/domain-event-delivery.entity';
import { RedisProvider } from '../../providers/redis/redis.provider';

const CONVERSATION_CACHE_INVALIDATE_EVENT = 'conversation.cache_invalidate';
const CONVERSATION_TURN_COMPLETED_EVENT = 'conversation.turn.completed';
const CONVERSATION_MEMORY_PERSIST_EVENT = 'conversation.memory.persist';
const CONVERSATION_DELETED_EVENT = 'conversation.deleted';

type InternalDomainEventHandler = (
  event: DomainEventOutboxEntity,
) => Promise<void>;

export type DomainEventInput = {
  tenantId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
};

@Injectable()
export class DomainEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsService.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;
  private readonly dispatchLockKey = 'rag:domain-events:dispatch-lock';
  private readonly lockTtlSeconds: number;
  private readonly requireDistributedLock: boolean;
  private readonly internalHandlers = new Map<
    string,
    InternalDomainEventHandler
  >();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DomainEventOutboxEntity)
    private readonly outbox: Repository<DomainEventOutboxEntity>,
    @InjectRepository(DomainEventSubscriptionEntity)
    private readonly subscriptions: Repository<DomainEventSubscriptionEntity>,
    private readonly redisProvider: RedisProvider,
    @Optional()
    @InjectRepository(DomainEventDeliveryEntity)
    private readonly deliveries?: Repository<DomainEventDeliveryEntity>,
  ) {
    // 生产默认要求共享租约；开发环境可以保留单实例降级，便于本地启动。
    this.requireDistributedLock =
      this.config.get<boolean>('domainEvents.requireDistributedLock') === true;
    this.lockTtlSeconds = Math.min(
      Math.max(
        Number(this.config.get<number>('domainEvents.lockTtlSeconds') ?? 120),
        30,
      ),
      900,
    );
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchPending(), 10_000);
    this.timer.unref();
    void this.dispatchPending();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async emit(input: DomainEventInput): Promise<void> {
    await this.persist(this.outbox, input);
  }

  /**
   * 与业务表共享同一 TypeORM transaction 的 Outbox 写入入口。
   * 外部投递仍由提交后的 dispatcher 完成，事务回滚时不会留下幽灵事件。
   */
  async emitInTransaction(
    manager: EntityManager,
    input: DomainEventInput,
  ): Promise<void> {
    await this.persist(manager.getRepository(DomainEventOutboxEntity), input);
  }

  registerInternalHandler(
    eventType: string,
    handler: InternalDomainEventHandler,
  ): void {
    if (this.internalHandlers.has(eventType)) {
      throw new Error(
        `Internal domain event handler already registered: ${eventType}`,
      );
    }
    this.internalHandlers.set(eventType, handler);
  }

  private async persist(
    outbox: Repository<DomainEventOutboxEntity>,
    input: DomainEventInput,
  ): Promise<void> {
    const safePayload = this.safePayload(input.payload ?? {});
    const tenantId = input.tenantId ?? 'legacy';
    // 没有显式幂等键时按事件内容生成摘要：同一事件重试仍幂等，
    // 但同一聚合的后续状态变更不会被旧事件吞掉。
    const idempotencyKey =
      input.idempotencyKey ??
      `auto:${createHash('sha256')
        .update(
          JSON.stringify({
            eventType: input.eventType,
            tenantId,
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            payload: safePayload,
          }),
        )
        .digest('hex')}`;
    const existing = await outbox.findOne({ where: { idempotencyKey } });
    if (existing) {
      if (
        input.eventType === 'workflow.dispatch.requested' &&
        (existing.eventType !== input.eventType ||
          existing.aggregateId !== input.aggregateId ||
          existing.tenantId !== tenantId ||
          existing.payload !== JSON.stringify(safePayload))
      ) {
        throw new ConflictException(
          'workflow dispatch ID reused with different identity or payload',
        );
      }
      return;
    }
    try {
      const event = outbox.create({
        id: randomUUID(),
        idempotencyKey,
        eventType: input.eventType,
        tenantId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: JSON.stringify(safePayload),
        status: 'pending',
        availableAt: new Date(),
      });
      if (input.eventType === 'workflow.dispatch.requested') {
        event.maxAttempts = 16;
      }
      if (
        input.eventType === CONVERSATION_TURN_COMPLETED_EVENT ||
        input.eventType === CONVERSATION_MEMORY_PERSIST_EVENT ||
        input.eventType === CONVERSATION_DELETED_EVENT
      ) {
        event.maxAttempts = 8;
      }
      await outbox.save(event);
    } catch (error) {
      // 多实例并发 emit 时由数据库唯一约束完成最终幂等；并发撞车应视为已存在，
      // 其他数据库错误仍然向上抛出，不能静默丢掉事件。
      if (this.isUniqueViolation(error)) {
        if (input.eventType === 'workflow.dispatch.requested') {
          const sameId = await outbox.findOne({ where: { idempotencyKey } });
          if (
            !sameId ||
            sameId.aggregateId !== input.aggregateId ||
            sameId.tenantId !== tenantId ||
            sameId.payload !== JSON.stringify(safePayload)
          ) {
            throw new ConflictException('workflow dispatch ID collision');
          }
        }
        return;
      }
      throw error;
    }
  }

  async listOutbox(limit = 100, eventType?: string) {
    const rows = await this.outbox.find({
      where: eventType ? { eventType } : undefined,
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map((row) => ({ ...row, payload: this.parse(row.payload) }));
  }

  async retry(id: string) {
    return this.outbox.manager.transaction(async (manager) => {
      const outbox = manager.getRepository(DomainEventOutboxEntity);
      const now = new Date();
      const result = await outbox
        .createQueryBuilder()
        .update(DomainEventOutboxEntity)
        .set({
          status: 'pending',
          attempts: 0,
          lastError: null,
          availableAt: now,
          deliveredAt: null,
        })
        .where('id = :id AND status = :status', { id, status: 'failed' })
        .execute();

      if (result.affected !== 1) {
        const row = await outbox.findOneBy({ id });
        if (!row) return null;
        throw new ConflictException('Only failed outbox events can be retried');
      }

      if (this.deliveries) {
        await manager
          .getRepository(DomainEventDeliveryEntity)
          .createQueryBuilder()
          .update(DomainEventDeliveryEntity)
          .set({
            status: 'pending',
            attempts: 0,
            availableAt: now,
            deliveredAt: null,
            lastError: null,
          })
          .where('eventId = :eventId AND status = :status', {
            eventId: id,
            status: 'failed',
          })
          .execute();
      }

      return outbox.findOneBy({ id });
    });
  }

  async listSubscriptions() {
    const rows = await this.subscriptions.find({
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => ({
      ...row,
      eventTypes: this.parseArray(row.eventTypes),
    }));
  }

  async upsertSubscription(input: {
    tenantId?: string;
    id?: string;
    name: string;
    eventTypes: string[];
    channel: 'enterprise_wechat' | 'webhook';
    endpointKey: string;
    enabled?: boolean;
  }) {
    const row = input.id
      ? await this.subscriptions.findOneBy({ id: input.id })
      : null;
    const entity = row ?? this.subscriptions.create({ id: randomUUID() });
    entity.name = input.name.trim();
    entity.tenantId = input.tenantId ?? 'legacy';
    entity.eventTypes = JSON.stringify([...new Set(input.eventTypes)]);
    entity.channel = input.channel;
    entity.endpointKey = input.endpointKey.trim();
    entity.enabled = input.enabled ?? true;
    return this.subscriptions.save(entity);
  }

  private async dispatchPending(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    const lockToken = randomUUID();
    let lockAcquired = false;
    try {
      if (this.redisProvider.isEnabled()) {
        lockAcquired = await this.redisProvider.setIfAbsent(
          this.dispatchLockKey,
          lockToken,
          this.lockTtlSeconds,
        );
        if (!lockAcquired) {
          if (this.requireDistributedLock) {
            await this.dispatchInternalCacheInvalidations();
          }
          return;
        }
      } else if (this.requireDistributedLock) {
        this.logger.error(
          'Domain event dispatch skipped: distributed Redis lock is required but unavailable.',
        );
        await this.dispatchInternalCacheInvalidations();
        return;
      }
      const rows = await this.outbox
        .createQueryBuilder('event')
        .where('event.status = :status', { status: 'pending' })
        .andWhere('(event.availableAt IS NULL OR event.availableAt <= :now)', {
          now: new Date(),
        })
        .orderBy('event.createdAt', 'ASC')
        .take(20)
        .getMany();
      for (const row of rows) {
        if (lockAcquired) {
          const renewed = await this.redisProvider.renewLock(
            this.dispatchLockKey,
            lockToken,
            this.lockTtlSeconds,
          );
          if (!renewed) {
            this.logger.warn(
              'Outbox dispatch lease was lost; stopping this batch to avoid duplicate delivery.',
            );
            if (
              row.eventType === CONVERSATION_CACHE_INVALIDATE_EVENT &&
              this.requireDistributedLock
            ) {
              await this.deliver(row);
            }
            return;
          }
        }
        await this.deliver(row);
      }
    } catch (error) {
      this.logger.warn(`Outbox dispatch skipped: ${this.message(error)}`);
    } finally {
      if (lockAcquired)
        await this.redisProvider.releaseLock(this.dispatchLockKey, lockToken);
      this.dispatching = false;
    }
  }

  /**
   * Cache DEL is idempotent, so internal invalidations can progress without a
   * Redis lease. External subscriptions remain blocked until the shared lock
   * is available.
   */
  private async dispatchInternalCacheInvalidations(): Promise<void> {
    const rows = await this.outbox
      .createQueryBuilder('event')
      .where('event.status = :status', { status: 'pending' })
      .andWhere('event.eventType = :eventType', {
        eventType: CONVERSATION_CACHE_INVALIDATE_EVENT,
      })
      .andWhere('(event.availableAt IS NULL OR event.availableAt <= :now)', {
        now: new Date(),
      })
      .orderBy('event.createdAt', 'ASC')
      .take(20)
      .getMany();
    for (const row of rows) await this.deliver(row);
  }

  private async deliver(row: DomainEventOutboxEntity): Promise<void> {
    // Persisted workflow dispatch is internal-only; never forward request DTOs to external webhooks.
    if (row.eventType === 'workflow.dispatch.requested') {
      await this.deliverConversationTurnCompleted(row);
      return;
    }
    // Internal events never enter the configurable Webhook／企微 subscription path.
    if (row.eventType === CONVERSATION_CACHE_INVALIDATE_EVENT) {
      await this.deliverConversationCacheInvalidation(row);
      return;
    }
    if (row.eventType === CONVERSATION_TURN_COMPLETED_EVENT) {
      await this.deliverConversationTurnCompleted(row);
      return;
    }
    if (row.eventType === CONVERSATION_MEMORY_PERSIST_EVENT) {
      await this.deliverConversationMemoryPersist(row);
      return;
    }
    if (row.eventType === CONVERSATION_DELETED_EVENT) {
      await this.deliverConversationDeleted(row);
      return;
    }
    if (this.internalHandlers.has(row.eventType)) {
      await this.deliverInternal(row);
      return;
    }

    const subscribers = (
      await this.subscriptions.find({ where: { enabled: true } })
    ).filter(
      (item) =>
        this.parseArray(item.eventTypes).includes(row.eventType) &&
        (item.tenantId === null || item.tenantId === row.tenantId),
    );
    if (subscribers.length === 0) {
      row.status = 'skipped';
      row.deliveredAt = new Date();
      await this.outbox.save(row);
      return;
    }
    if (!this.deliveries) {
      try {
        for (const subscription of subscribers)
          await this.post(subscription, row, row.id);
        row.status = 'delivered';
        row.deliveredAt = new Date();
        row.lastError = null;
      } catch (error) {
        row.attempts += 1;
        row.lastError = this.message(error).slice(0, 1000);
        if (row.attempts >= row.maxAttempts) row.status = 'failed';
        else row.availableAt = new Date(Date.now() + 1000 * 2 ** row.attempts);
      }
      await this.outbox.save(row);
      return;
    }
    const now = new Date();
    const states: DomainEventDeliveryEntity[] = [];
    for (const subscription of subscribers) {
      let delivery = await this.deliveries.findOne({
        where: { eventId: row.id, subscriptionId: subscription.id },
      });
      if (!delivery) {
        try {
          delivery = await this.deliveries.save(
            this.deliveries.create({
              id: randomUUID(),
              eventId: row.id,
              subscriptionId: subscription.id,
              status: 'pending',
              availableAt: now,
            }),
          );
        } catch (error) {
          if (!this.isUniqueViolation(error)) throw error;
          delivery = await this.deliveries.findOneOrFail({
            where: { eventId: row.id, subscriptionId: subscription.id },
          });
        }
      }
      if (delivery.status === 'delivered') {
        states.push(delivery);
        continue;
      }
      // Failed is terminal for this subscriber until an explicit retry resets
      // that delivery row. Other subscribers can continue independently.
      if (delivery.status === 'failed') {
        states.push(delivery);
        continue;
      }
      if (delivery.availableAt && delivery.availableAt > now) {
        states.push(delivery);
        continue;
      }
      const deliveryLockKey = `rag:domain-events:delivery:${delivery.id}`;
      const deliveryLockToken = randomUUID();
      const deliveryLeaseRequired = this.redisProvider.isEnabled();
      if (
        deliveryLeaseRequired &&
        !(await this.redisProvider.setIfAbsent(
          deliveryLockKey,
          deliveryLockToken,
          this.lockTtlSeconds,
        ))
      ) {
        // The global batch lease may expire during a slow subscriber call.
        // A per-delivery lease keeps another instance from posting it twice.
        states.push(delivery);
        continue;
      }
      try {
        try {
          await this.post(subscription, row, delivery.id);
          delivery.status = 'delivered';
          delivery.deliveredAt = new Date();
          delivery.lastError = null;
        } catch (error) {
          delivery.attempts += 1;
          delivery.lastError = this.message(error).slice(0, 1000);
          delivery.status =
            delivery.attempts >= delivery.maxAttempts ? 'failed' : 'pending';
          delivery.availableAt = new Date(
            Date.now() + 1000 * 2 ** delivery.attempts,
          );
          row.lastError = delivery.lastError;
        }
        await this.deliveries.save(delivery);
      } finally {
        if (deliveryLeaseRequired) {
          await this.redisProvider.releaseLock(
            deliveryLockKey,
            deliveryLockToken,
          );
        }
      }
      states.push(delivery);
    }
    const hasPending = states.some((state) => state.status === 'pending');
    const hasFailed = states.some((state) => state.status === 'failed');
    row.attempts = Math.max(
      row.attempts,
      ...states.map((state) => state.attempts),
    );
    if (!hasPending && !hasFailed) {
      row.status = 'delivered';
      row.deliveredAt = new Date();
      row.lastError = null;
    } else if (!hasPending && hasFailed) {
      row.status = 'failed';
    } else {
      row.status = 'pending';
      row.availableAt = new Date(
        Date.now() + 1000 * 2 ** Math.min(row.attempts, 8),
      );
    }
    await this.outbox.save(row);
  }

  private async deliverInternal(row: DomainEventOutboxEntity): Promise<void> {
    try {
      const handler = this.internalHandlers.get(row.eventType);
      if (!handler) {
        throw new Error(
          `Internal domain event handler is unavailable: ${row.eventType}`,
        );
      }
      await handler(row);
      row.status = 'delivered';
      row.deliveredAt = new Date();
      row.lastError = null;
    } catch (error) {
      row.attempts += 1;
      row.lastError = this.message(error).slice(0, 1000);
      if (row.attempts >= row.maxAttempts) {
        row.status = 'failed';
      } else {
        row.status = 'pending';
        row.availableAt = new Date(Date.now() + 1000 * 2 ** row.attempts);
      }
      this.logger.warn(
        `Internal event delivery failed: eventType=${row.eventType}, aggregateId=${row.aggregateId}, attempt=${row.attempts}`,
      );
    }
    await this.outbox.save(row);
  }

  private async deliverConversationTurnCompleted(
    row: DomainEventOutboxEntity,
  ): Promise<void> {
    try {
      const handler = this.internalHandlers.get(row.eventType);
      if (!handler) {
        throw new Error(
          `Internal domain event handler is unavailable: ${row.eventType}`,
        );
      }
      await handler(row);
      row.status = 'delivered';
      row.deliveredAt = new Date();
      row.lastError = null;
    } catch (error) {
      row.attempts += 1;
      row.lastError = this.message(error).slice(0, 1000);
      if (row.attempts >= row.maxAttempts) {
        row.status = 'failed';
      } else {
        row.status = 'pending';
        row.availableAt = new Date(Date.now() + 1000 * 2 ** row.attempts);
      }
      this.logger.warn(
        `Conversation turn indexing failed: threadId=${row.aggregateId}, attempt=${row.attempts}`,
      );
    }
    await this.outbox.save(row);
  }

  private async deliverConversationMemoryPersist(
    row: DomainEventOutboxEntity,
  ): Promise<void> {
    try {
      const handler = this.internalHandlers.get(row.eventType);
      if (!handler) {
        throw new Error(
          `Internal domain event handler is unavailable: ${row.eventType}`,
        );
      }
      await handler(row);
      row.status = 'delivered';
      row.deliveredAt = new Date();
      row.lastError = null;
    } catch (error) {
      row.attempts += 1;
      row.lastError = this.message(error).slice(0, 1000);
      if (row.attempts >= row.maxAttempts) {
        row.status = 'failed';
      } else {
        row.status = 'pending';
        row.availableAt = new Date(Date.now() + 1000 * 2 ** row.attempts);
      }
      this.logger.warn(
        `Conversation memory persistence failed: threadId=${row.aggregateId}, attempt=${row.attempts}`,
      );
    }
    await this.outbox.save(row);
  }

  private async deliverConversationDeleted(
    row: DomainEventOutboxEntity,
  ): Promise<void> {
    try {
      const handler = this.internalHandlers.get(row.eventType);
      if (!handler) {
        throw new Error(
          `Internal domain event handler is unavailable: ${row.eventType}`,
        );
      }
      await handler(row);
      row.status = 'delivered';
      row.deliveredAt = new Date();
      row.lastError = null;
    } catch (error) {
      row.attempts += 1;
      row.lastError = this.message(error).slice(0, 1000);
      if (row.attempts >= row.maxAttempts) {
        row.status = 'failed';
      } else {
        row.status = 'pending';
        row.availableAt = new Date(Date.now() + 1000 * 2 ** row.attempts);
      }
      this.logger.warn(
        `Conversation deletion cleanup failed: threadId=${row.aggregateId}, attempt=${row.attempts}`,
      );
    }
    await this.outbox.save(row);
  }

  private async deliverConversationCacheInvalidation(
    row: DomainEventOutboxEntity,
  ): Promise<void> {
    try {
      const payload = this.parse(row.payload);
      if (!Object.prototype.hasOwnProperty.call(payload, 'userId')) {
        throw new Error('conversation cache invalidation is missing userId');
      }
      const userId = payload.userId;
      if (userId !== null && typeof userId !== 'string') {
        throw new Error('conversation cache invalidation has invalid userId');
      }
      const threadId = row.aggregateId.trim();
      if (!threadId) {
        throw new Error('conversation cache invalidation is missing threadId');
      }

      if (!this.redisProvider.isConfigured()) {
        row.status = 'skipped';
        row.deliveredAt = new Date();
        row.lastError = null;
        await this.outbox.save(row);
        return;
      }
      if (!this.redisProvider.isEnabled()) {
        throw new Error('Redis is configured but unavailable');
      }

      const tenantId = row.tenantId?.trim() || 'legacy';
      const tenantScopes = new Set([tenantId, 'legacy']);
      const keys = new Set([`conv:messages:${threadId}`]);
      for (const scope of tenantScopes) {
        keys.add(`conv:messages:${scope}:${threadId}`);
        if (typeof userId === 'string' && userId.trim()) {
          keys.add(`conv:messages:${scope}:${userId}:${threadId}`);
        }
      }
      await Promise.all(
        [...keys].map((key) => this.redisProvider.delRequired(key)),
      );

      row.status = 'delivered';
      row.deliveredAt = new Date();
      row.lastError = null;
    } catch (error) {
      row.attempts += 1;
      row.lastError = this.message(error).slice(0, 1000);
      if (row.attempts >= row.maxAttempts) {
        row.status = 'failed';
      } else {
        row.status = 'pending';
        row.availableAt = new Date(Date.now() + 1000 * 2 ** row.attempts);
      }
      this.logger.warn(
        `Conversation cache invalidation failed: threadId=${row.aggregateId}, attempt=${row.attempts}`,
      );
    }
    await this.outbox.save(row);
  }

  private async post(
    subscription: DomainEventSubscriptionEntity,
    row: DomainEventOutboxEntity,
    deliveryId: string,
  ): Promise<void> {
    const endpoint = this.config.get<string>(subscription.endpointKey);
    if (!endpoint)
      throw new Error(
        `missing server configuration for ${subscription.endpointKey}`,
      );
    const content =
      `[${row.eventType}] tenant=${row.tenantId ?? 'legacy'} ${row.aggregateType}/${row.aggregateId}\n${JSON.stringify(this.parse(row.payload))}`.slice(
        0,
        3500,
      );
    const body =
      subscription.channel === 'enterprise_wechat'
        ? { msgtype: 'markdown', markdown: { content } }
        : {
            id: row.id,
            deliveryId,
            tenantId: row.tenantId ?? 'legacy',
            eventType: row.eventType,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            payload: this.parse(row.payload),
            occurredAt: row.createdAt.toISOString(),
          };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
  }

  private safePayload(payload: unknown): unknown {
    if (Array.isArray(payload)) {
      return payload.map((item) => this.safePayload(item));
    }
    if (!payload || typeof payload !== 'object') return payload;
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (
        /^(prompt|token|password|secret|api[_-]?key|authorization|cookie|set-cookie)$/i.test(
          key,
        )
      ) {
        continue;
      }
      safe[key] = this.safePayload(value);
    }
    return safe;
  }
  private parse(value: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  private parseArray(value: string): string[] {
    try {
      const items: unknown = JSON.parse(value);
      return Array.isArray(items)
        ? items.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
