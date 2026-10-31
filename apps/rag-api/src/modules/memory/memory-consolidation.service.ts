import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  Mem0Provider,
  type Mem0MemoryResult,
} from '../../providers/mem0/mem0.provider';
import { RedisProvider } from '../../providers/redis/redis.provider';
import {
  getPromptMetadata,
  getPromptVersion,
} from '../../rag/prompts/prompt-registry';
import { memoryConsolidationSystemPrompt } from './memory.prompts';

const CONSOLIDATION_LOCK_KEY = 'rag:memory:consolidation:lock';
const CONSOLIDATION_CURSOR_KEY = 'rag:memory:consolidation:cursor';
const MAX_USERS_PER_RUN = 10;
const MIN_SOURCE_MEMORIES = 20;
const MAX_SOURCE_MEMORIES = 30;
const MAX_SOURCE_MEMORY_CHARS = 4_000;
const MAX_TOTAL_SOURCE_CHARS = 24_000;
const LOCK_TTL_SECONDS = 4 * 60 * 60;
const REVIEW_LOCK_TTL_SECONDS = 10 * 60;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const consolidationOutputSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
});

interface ConsolidationSourceFingerprint {
  id: string;
  fingerprint: string;
}

export interface ConsolidationProposalView {
  id: string;
  summary: string;
  status: 'pending_review';
  createdAt: string | null;
  promptVersion: string | null;
  sources: Array<{
    id: string;
    memory: string | null;
    recordedAt: string | null;
    current: boolean;
  }>;
}

@Injectable()
export class MemoryConsolidationService {
  private readonly logger = new Logger(MemoryConsolidationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mem0Provider: Mem0Provider,
    private readonly llmProvider: LlmProvider,
    private readonly redis: RedisProvider,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  /** Weekly, opt-in maintenance. Original memories are retained unchanged. */
  @Cron('0 3 * * 0', { timeZone: 'Asia/Shanghai' })
  async runScheduledConsolidation(): Promise<void> {
    if (!this.config.get<boolean>('mem0.consolidation.enabled', false)) return;
    if (!this.mem0Provider.isEnabled()) return;
    if (!this.redis.isEnabled()) {
      this.logger.warn(
        'Mem0 consolidation skipped because Redis is unavailable for the distributed lock.',
      );
      return;
    }

    const lockToken = randomUUID();
    let acquired = false;
    try {
      acquired = await this.redis.setIfAbsentRequired(
        CONSOLIDATION_LOCK_KEY,
        lockToken,
        LOCK_TTL_SECONDS,
      );
      if (!acquired) return;

      await this.llmProvider.runWithRequestBudget(() =>
        this.processUserBatch(),
      );
    } catch (error) {
      this.logger.error(
        `Scheduled Mem0 consolidation failed: ${(error as Error).message}`,
      );
    } finally {
      if (acquired) {
        try {
          await this.redis.compareAndDeleteRequired(
            CONSOLIDATION_LOCK_KEY,
            lockToken,
          );
        } catch (error) {
          this.logger.warn(
            `Could not release Mem0 consolidation lock: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  async listPending(userId: string): Promise<ConsolidationProposalView[]> {
    this.assertAvailable();
    const memories = await this.mem0Provider.getAll(
      userId,
      undefined,
      false,
      true,
    );
    const byId = new Map(memories.map((memory) => [memory.id, memory]));

    return memories
      .filter(
        (memory) =>
          this.isConsolidation(memory) &&
          memory.metadata?.rag_consolidation_status === 'pending_review',
      )
      .map((proposal) => {
        const snapshots = this.readSourceFingerprints(proposal.metadata);
        return {
          id: proposal.id,
          summary: proposal.memory,
          status: 'pending_review' as const,
          createdAt: this.stringMetadata(
            proposal.metadata,
            'rag_consolidation_created_at',
          ),
          promptVersion: this.stringMetadata(
            proposal.metadata,
            'rag_consolidation_prompt_version',
          ),
          sources: snapshots.map((snapshot) => {
            const source = byId.get(snapshot.id);
            return {
              id: snapshot.id,
              memory: source?.memory ?? null,
              recordedAt: this.stringMetadata(
                source?.metadata,
                'rag_recorded_at',
              ),
              current: Boolean(
                source &&
                this.fingerprint(source) === snapshot.fingerprint &&
                this.isActiveUserSource(source),
              ),
            };
          }),
        };
      });
  }

  async approve(
    userId: string,
    memoryId: string,
  ): Promise<{ id: string; status: string }> {
    this.assertAvailable();
    return this.withReviewLock(userId, memoryId, async () => {
      const memories = await this.mem0Provider.getAll(
        userId,
        undefined,
        false,
        true,
      );
      const proposal = memories.find((memory) => memory.id === memoryId);
      if (!proposal || !this.isConsolidation(proposal)) {
        throw new NotFoundException('Memory consolidation proposal not found.');
      }
      const status = proposal.metadata?.rag_consolidation_status;
      if (status === 'approved') return { id: proposal.id, status: 'approved' };
      if (status !== 'pending_review') {
        throw new ConflictException('Proposal is no longer pending review.');
      }

      const snapshots = this.readSourceFingerprints(proposal.metadata);
      const byId = new Map(memories.map((memory) => [memory.id, memory]));
      const sourcesAreCurrent =
        snapshots.length >= MIN_SOURCE_MEMORIES &&
        snapshots.every((snapshot) => {
          const source = byId.get(snapshot.id);
          return Boolean(
            source &&
            this.isActiveUserSource(source) &&
            this.fingerprint(source) === snapshot.fingerprint,
          );
        });
      if (!sourcesAreCurrent) {
        await this.mem0Provider.updateMetadata(proposal.id, {
          ...(proposal.metadata ?? {}),
          rag_consolidation_status: 'stale',
          rag_consolidation_stale_at: new Date().toISOString(),
        });
        throw new ConflictException(
          'Source memories changed or expired; the proposal was marked stale.',
        );
      }

      await this.mem0Provider.updateMetadata(proposal.id, {
        ...(proposal.metadata ?? {}),
        rag_consolidation_status: 'approved',
        rag_consolidation_reviewed_at: new Date().toISOString(),
      });
      return { id: proposal.id, status: 'approved' };
    });
  }

  async reject(
    userId: string,
    memoryId: string,
  ): Promise<{ id: string; status: string }> {
    this.assertAvailable();
    return this.withReviewLock(userId, memoryId, async () => {
      const memories = await this.mem0Provider.getAll(
        userId,
        undefined,
        false,
        true,
      );
      const proposal = memories.find((memory) => memory.id === memoryId);
      if (!proposal || !this.isConsolidation(proposal)) {
        throw new NotFoundException('Memory consolidation proposal not found.');
      }
      const status = proposal.metadata?.rag_consolidation_status;
      if (status === 'rejected') return { id: proposal.id, status: 'rejected' };
      if (status !== 'pending_review') {
        throw new ConflictException('Proposal is no longer pending review.');
      }

      await this.mem0Provider.updateMetadata(proposal.id, {
        ...(proposal.metadata ?? {}),
        rag_consolidation_status: 'rejected',
        rag_consolidation_reviewed_at: new Date().toISOString(),
      });
      return { id: proposal.id, status: 'rejected' };
    });
  }

  async revoke(
    userId: string,
    memoryId: string,
  ): Promise<{ id: string; status: string }> {
    this.assertAvailable();
    return this.withReviewLock(userId, memoryId, async () => {
      const memories = await this.mem0Provider.getAll(
        userId,
        undefined,
        false,
        true,
      );
      const proposal = memories.find((memory) => memory.id === memoryId);
      if (!proposal || !this.isConsolidation(proposal)) {
        throw new NotFoundException('Memory consolidation proposal not found.');
      }
      const status = proposal.metadata?.rag_consolidation_status;
      if (status === 'revoked') return { id: proposal.id, status: 'revoked' };
      if (status !== 'approved') {
        throw new ConflictException(
          'Only an approved proposal can be revoked.',
        );
      }

      await this.mem0Provider.updateMetadata(proposal.id, {
        ...(proposal.metadata ?? {}),
        rag_consolidation_status: 'revoked',
        rag_consolidation_reviewed_at: new Date().toISOString(),
      });
      return { id: proposal.id, status: 'revoked' };
    });
  }

  /** Invalidates proposals when a source fact is explicitly superseded. */
  async invalidateForSupersededSources(
    userId: string,
    sourceIds: string[],
  ): Promise<void> {
    if (!sourceIds.length) return;
    const sourceIdSet = new Set(sourceIds);
    const memories = await this.mem0Provider.getAll(
      userId,
      undefined,
      false,
      true,
    );
    for (const memory of memories) {
      if (
        !this.isConsolidation(memory) ||
        !['pending_review', 'approved'].includes(
          String(memory.metadata?.rag_consolidation_status),
        )
      ) {
        continue;
      }
      const hasSupersededSource = this.readSourceFingerprints(
        memory.metadata,
      ).some((source) => sourceIdSet.has(source.id));
      if (!hasSupersededSource) continue;
      await this.mem0Provider.updateMetadata(memory.id, {
        ...(memory.metadata ?? {}),
        rag_consolidation_status: 'stale',
        rag_consolidation_stale_at: new Date().toISOString(),
      });
    }
  }

  private async processUserBatch(): Promise<void> {
    let cursor =
      (await this.redis.getRequired(CONSOLIDATION_CURSOR_KEY)) || null;
    let users = await this.findUsersAfter(cursor);
    if (users.length === 0 && cursor) {
      cursor = null;
      users = await this.findUsersAfter(null);
    }

    for (const user of users) {
      try {
        await this.createProposalIfNeeded(user.id);
        await this.redis.setRequiredOrThrow(CONSOLIDATION_CURSOR_KEY, user.id);
      } catch (error) {
        this.logger.error(
          `Mem0 consolidation stopped at user ${user.id}: ${(error as Error).message}`,
        );
        return;
      }
    }
  }

  private findUsersAfter(cursor: string | null): Promise<UserEntity[]> {
    const query = this.userRepository
      .createQueryBuilder('user')
      .select(['user.id'])
      .orderBy('user.id', 'ASC')
      .take(MAX_USERS_PER_RUN);
    if (cursor) query.where('user.id > :cursor', { cursor });
    return query.getMany();
  }

  private async createProposalIfNeeded(userId: string): Promise<void> {
    const memories = await this.mem0Provider.getAll(
      userId,
      undefined,
      false,
      true,
    );
    const proposals = memories.filter((memory) => this.isConsolidation(memory));
    if (
      proposals.some(
        (memory) =>
          memory.metadata?.rag_consolidation_status === 'pending_review',
      )
    ) {
      return;
    }

    const alreadyHandledSourceIds = new Set<string>();
    for (const proposal of proposals) {
      if (
        ['approved', 'rejected', 'revoked'].includes(
          String(proposal.metadata?.rag_consolidation_status),
        )
      ) {
        for (const source of this.readSourceFingerprints(proposal.metadata)) {
          alreadyHandledSourceIds.add(source.id);
        }
      }
    }

    const candidates = memories
      .filter(
        (memory) =>
          this.isActiveUserSource(memory) &&
          !alreadyHandledSourceIds.has(memory.id),
      )
      .sort((left, right) => {
        const leftDate =
          this.stringMetadata(left.metadata, 'rag_recorded_at') ?? '';
        const rightDate =
          this.stringMetadata(right.metadata, 'rag_recorded_at') ?? '';
        return (
          leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id)
        );
      });

    const sources: Mem0MemoryResult[] = [];
    let inputCharacters = 0;
    for (const candidate of candidates) {
      const text = candidate.memory.trim();
      if (!text || text.length > MAX_SOURCE_MEMORY_CHARS) continue;
      if (inputCharacters + text.length > MAX_TOTAL_SOURCE_CHARS) continue;
      sources.push(candidate);
      inputCharacters += text.length;
      if (sources.length >= MAX_SOURCE_MEMORIES) break;
    }
    if (sources.length < MIN_SOURCE_MEMORIES) return;

    const snapshots = sources.map((source) => ({
      id: source.id,
      fingerprint: this.fingerprint(source),
    }));
    const sourceHash = this.hashSourceSet(snapshots);
    if (
      proposals.some(
        (proposal) =>
          proposal.metadata?.rag_consolidation_status !== 'stale' &&
          proposal.metadata?.rag_consolidation_source_hash === sourceHash,
      )
    ) {
      return;
    }

    const promptVersion = getPromptVersion('memory.consolidation');
    const model = this.llmProvider
      .getModel()
      .withStructuredOutput(consolidationOutputSchema);
    const output = await model.invoke(
      [
        new SystemMessage(memoryConsolidationSystemPrompt),
        new HumanMessage(
          JSON.stringify(
            sources.map((source) => ({
              id: source.id,
              recordedAt:
                this.stringMetadata(source.metadata, 'rag_recorded_at') ?? null,
              memory: source.memory,
            })),
          ),
        ),
      ],
      { metadata: getPromptMetadata('memory.consolidation') },
    );
    const summary = output.summary.trim();
    if (!summary)
      throw new Error('Mem0 consolidation generated an empty summary.');

    const createdAt = new Date().toISOString();
    await this.mem0Provider.add({
      messages: [{ role: 'user', content: summary }],
      userId,
      infer: false,
      metadata: {
        rag_memory_scope: 'user',
        rag_memory_kind: 'consolidation',
        rag_consolidation_status: 'pending_review',
        rag_consolidation_created_at: createdAt,
        rag_consolidation_prompt_version: promptVersion,
        rag_consolidation_source_hash: sourceHash,
        rag_consolidation_sources: snapshots,
      },
    });
    this.logger.log(
      `Created a pending Mem0 consolidation proposal for user ${userId} from ${sources.length} source memories.`,
    );
  }

  private async withReviewLock<T>(
    userId: string,
    memoryId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException(
        'Redis is required to safely review a memory consolidation proposal.',
      );
    }
    const keySuffix = createHash('sha256')
      .update(`${userId}:${memoryId}`)
      .digest('hex');
    const key = `rag:memory:consolidation:decision:${keySuffix}`;
    const lockToken = randomUUID();
    const acquired = await this.redis.setIfAbsentRequired(
      key,
      lockToken,
      REVIEW_LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      throw new ConflictException('Proposal review is already in progress.');
    }

    try {
      return await callback();
    } finally {
      try {
        await this.redis.compareAndDeleteRequired(key, lockToken);
      } catch (error) {
        this.logger.warn(
          `Could not release proposal review lock: ${(error as Error).message}`,
        );
      }
    }
  }

  private assertAvailable(): void {
    if (!this.mem0Provider.isEnabled()) {
      throw new ServiceUnavailableException('Mem0 is unavailable.');
    }
  }

  private isConsolidation(memory: Mem0MemoryResult): boolean {
    return memory.metadata?.rag_memory_kind === 'consolidation';
  }

  private isActiveUserSource(memory: Mem0MemoryResult): boolean {
    const metadata = memory.metadata ?? {};
    const scope = metadata.rag_memory_scope;
    if (this.isConsolidation(memory)) return false;
    if (scope !== 'user' && (scope !== undefined || metadata.run_id))
      return false;
    if (typeof metadata.rag_superseded_at === 'string') return false;
    if (typeof metadata.rag_valid_until === 'string') {
      const validUntil = metadata.rag_valid_until;
      if (
        DATE_PATTERN.test(validUntil) &&
        validUntil < new Date().toISOString().slice(0, 10)
      ) {
        return false;
      }
      // Keep time-bounded facts out of durable consolidation to avoid extending their lifetime.
      return false;
    }
    return Boolean(memory.memory.trim());
  }

  private fingerprint(memory: Mem0MemoryResult): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          id: memory.id,
          memory: memory.memory,
          recordedAt: this.stringMetadata(memory.metadata, 'rag_recorded_at'),
          validUntil: this.stringMetadata(memory.metadata, 'rag_valid_until'),
          supersededAt: this.stringMetadata(
            memory.metadata,
            'rag_superseded_at',
          ),
        }),
      )
      .digest('hex');
  }

  private hashSourceSet(sources: ConsolidationSourceFingerprint[]): string {
    return createHash('sha256')
      .update(
        JSON.stringify(
          [...sources]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(({ id, fingerprint }) => ({ id, fingerprint })),
        ),
      )
      .digest('hex');
  }

  private readSourceFingerprints(
    metadata?: Record<string, unknown>,
  ): ConsolidationSourceFingerprint[] {
    const sources = metadata?.rag_consolidation_sources;
    if (!Array.isArray(sources)) return [];
    return sources.filter((source): source is ConsolidationSourceFingerprint =>
      Boolean(
        source &&
        typeof source === 'object' &&
        typeof (source as Record<string, unknown>).id === 'string' &&
        typeof (source as Record<string, unknown>).fingerprint === 'string',
      ),
    );
  }

  private stringMetadata(
    metadata: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    const value = metadata?.[key];
    return typeof value === 'string' ? value : null;
  }
}
