import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { DomainEventOutboxEntity } from '../../providers/db/entities/domain-event-outbox.entity';
import { DomainEventSubscriptionEntity } from '../../providers/db/entities/domain-event-subscription.entity';

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

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DomainEventOutboxEntity)
    private readonly outbox: Repository<DomainEventOutboxEntity>,
    @InjectRepository(DomainEventSubscriptionEntity)
    private readonly subscriptions: Repository<DomainEventSubscriptionEntity>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchPending(), 10_000);
    this.timer.unref();
    void this.dispatchPending();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async emit(input: DomainEventInput): Promise<void> {
    const idempotencyKey =
      input.idempotencyKey ??
      `${input.eventType}:${input.aggregateType}:${input.aggregateId}`;
    const existing = await this.outbox.findOne({ where: { idempotencyKey } });
    if (existing) return;
    await this.outbox.save(
      this.outbox.create({
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
    try {
      const rows = await this.outbox.find({
        where: { status: 'pending' },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      for (const row of rows)
        if (!row.availableAt || row.availableAt <= new Date())
          await this.deliver(row);
    } catch (error) {
      this.logger.warn(`Outbox dispatch skipped: ${this.message(error)}`);
    } finally {
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
}
