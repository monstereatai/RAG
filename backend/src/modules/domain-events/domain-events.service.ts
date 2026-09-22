import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import { DomainEventOutboxEntity } from '../../providers/db/entities/domain-event-outbox.entity';
import { DomainEventSubscriptionEntity } from '../../providers/db/entities/domain-event-subscription.entity';
import { RedisProvider } from '../../providers/redis/redis.provider';

export type DomainEventInput = {
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

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DomainEventOutboxEntity)
    private readonly outbox: Repository<DomainEventOutboxEntity>,
    @InjectRepository(DomainEventSubscriptionEntity)
    private readonly subscriptions: Repository<DomainEventSubscriptionEntity>,
    private readonly redisProvider: RedisProvider,
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

  private async persist(
    outbox: Repository<DomainEventOutboxEntity>,
    input: DomainEventInput,
  ): Promise<void> {
    const idempotencyKey =
      input.idempotencyKey ??
      `${input.eventType}:${input.aggregateType}:${input.aggregateId}`;
    const existing = await outbox.findOne({ where: { idempotencyKey } });
    if (existing) return;
    try {
      await outbox.save(
        outbox.create({
          id: randomUUID(),
          idempotencyKey,
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload: JSON.stringify(this.safePayload(input.payload ?? {})),
          status: 'pending',
          availableAt: new Date(),
        }),
      );
    } catch (error) {
      // 多实例并发 emit 时由数据库唯一约束完成最终幂等；并发撞车应视为已存在，
      // 其他数据库错误仍然向上抛出，不能静默丢掉事件。
      if (this.isUniqueViolation(error)) return;
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
    const row = await this.outbox.findOneBy({ id });
    if (!row) return null;
    row.status = 'pending';
    row.attempts = 0;
    row.lastError = null;
    row.availableAt = new Date();
    row.deliveredAt = null;
    return this.outbox.save(row);
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
        if (!lockAcquired) return;
      } else if (this.requireDistributedLock) {
        this.logger.error(
          'Domain event dispatch skipped: distributed Redis lock is required but unavailable.',
        );
        return;
      }
      const rows = await this.outbox.find({
        where: { status: 'pending' },
        order: { createdAt: 'ASC' },
        take: 20,
      });
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
            return;
          }
        }
        if (!row.availableAt || row.availableAt <= new Date())
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

  private async deliver(row: DomainEventOutboxEntity): Promise<void> {
    const subscribers = (
      await this.subscriptions.find({ where: { enabled: true } })
    ).filter((item) =>
      this.parseArray(item.eventTypes).includes(row.eventType),
    );
    if (subscribers.length === 0) {
      row.status = 'skipped';
      row.deliveredAt = new Date();
      await this.outbox.save(row);
      return;
    }
    try {
      for (const subscription of subscribers)
        await this.post(subscription, row);
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
  }

  private async post(
    subscription: DomainEventSubscriptionEntity,
    row: DomainEventOutboxEntity,
  ): Promise<void> {
    const endpoint = this.config.get<string>(subscription.endpointKey);
    if (!endpoint)
      throw new Error(
        `missing server configuration for ${subscription.endpointKey}`,
      );
    const content =
      `[${row.eventType}] ${row.aggregateType}/${row.aggregateId}\n${JSON.stringify(this.parse(row.payload))}`.slice(
        0,
        3500,
      );
    const body =
      subscription.channel === 'enterprise_wechat'
        ? { msgtype: 'markdown', markdown: { content } }
        : {
            id: row.id,
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

  private safePayload(payload: Record<string, unknown>) {
    const { prompt, token, password, secret, ...safe } = payload;
    return safe;
  }
  private parse(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  private parseArray(value: string): string[] {
    try {
      const items = JSON.parse(value);
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
