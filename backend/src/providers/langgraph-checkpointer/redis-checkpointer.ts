import { Logger } from '@nestjs/common';
import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  MemorySaver,
  PendingWrite,
  SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import { RunnableConfig } from '@langchain/core/runnables';
import { RedisProvider } from '../../providers/redis/redis.provider';

/**
 * Redis-based LangGraph Checkpointer
 *
 * 将 LangGraph 状态持久化到 Redis，支持重启后恢复对话状态。
 * 对齐 @langchain/langgraph-checkpoint 的 BaseCheckpointSaver 接口。
 *
 * 存储结构：
 * - checkpoints:{threadId}:{checkpointId} → JSON 序列化 checkpoint
 * - writes:{threadId}:{checkpointId}:{taskId}:{idx} → pending writes
 * - thread:{threadId} → checkpoint list (sorted set by timestamp)
 */
export class RedisCheckpointer extends BaseCheckpointSaver {
  private readonly logger = new Logger(RedisCheckpointer.name);
  private readonly ttl: number;
  private readonly fallbackSaver: MemorySaver;

  constructor(
    private readonly redisProvider: RedisProvider,
    ttlSeconds = 86400 * 7, // 默认 7 天 TTL
    serde?: SerializerProtocol,
  ) {
    super(serde);
    this.ttl = ttlSeconds;
    this.fallbackSaver = new MemorySaver(serde);
  }

  /**
   * 获取指定 config 的 checkpoint
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    if (!this.redisProvider.isEnabled()) {
      return this.fallbackSaver.getTuple(config);
    }

    const threadId = config.configurable?.thread_id as string;
    const checkpointId = config.configurable?.checkpoint_id as
      | string
      | undefined;

    if (!threadId) {
      return undefined;
    }

    try {
      let targetId = checkpointId;

      // 如果没有指定 checkpoint_id，获取最新的
      if (!targetId) {
        const latestKey = await this.redisProvider.get(
          `checkpoint:latest:${threadId}`,
        );
        if (!latestKey) {
          return undefined;
        }
        targetId = latestKey;
      }

      const checkpointJson = await this.redisProvider.get(
        `checkpoint:${threadId}:${targetId}`,
      );
      if (!checkpointJson) {
        return undefined;
      }

      const checkpoint = JSON.parse(checkpointJson) as Checkpoint;
      const metadataJson = await this.redisProvider.get(
        `checkpoint:metadata:${threadId}:${targetId}`,
      );
      const metadata = metadataJson
        ? (JSON.parse(metadataJson) as CheckpointMetadata)
        : undefined;

      // 获取 pending writes
      const pendingWrites = await this.getPendingWrites(threadId, targetId);

      // 构建 parent config（如果有 parent_checkpoint_id）
      const parentCheckpointId = config.configurable?.parent_checkpoint_id as
        | string
        | undefined;
      const parentConfig: RunnableConfig | undefined = parentCheckpointId
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_id: parentCheckpointId,
            },
          }
        : undefined;

      return {
        config: {
          configurable: { thread_id: threadId, checkpoint_id: targetId },
        },
        checkpoint,
        metadata,
        parentConfig,
        pendingWrites,
      };
    } catch (err) {
      this.logger.warn(`getTuple failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * 列出指定 thread 的 checkpoints
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    if (!this.redisProvider.isEnabled()) {
      yield* this.fallbackSaver.list(config, options);
      return;
    }

    const threadId = config.configurable?.thread_id as string;
    if (!threadId) {
      return;
    }

    try {
      // 使用 sorted set 获取 checkpoint 列表（按时间倒序）
      const keys = await this.redisProvider.zrange(
        `thread:${threadId}`,
        0,
        -1,
        'REV',
      );

      const limit = options?.limit ?? keys.length;
      const before = options?.before?.configurable?.checkpoint_id as
        | string
        | undefined;

      let count = 0;
      let passedBefore = !before;

      for (const checkpointId of keys) {
        if (!passedBefore) {
          if (checkpointId === before) {
            passedBefore = true;
          }
          continue;
        }

        if (count >= limit) {
          break;
        }

        const tuple = await this.getTuple({
          configurable: { thread_id: threadId, checkpoint_id: checkpointId },
        });

        if (tuple) {
          yield tuple;
          count++;
        }
      }
    } catch (err) {
      this.logger.warn(`list failed: ${(err as Error).message}`);
    }
  }

  /**
   * 保存 checkpoint
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    if (!this.redisProvider.isEnabled()) {
      return this.fallbackSaver.put(config, checkpoint, metadata);
    }

    const threadId = config.configurable?.thread_id as string;
    if (!threadId) {
      throw new Error('thread_id is required in config');
    }

    const checkpointId = checkpoint.id;

    try {
      // 保存 checkpoint
      await this.redisProvider.set(
        `checkpoint:${threadId}:${checkpointId}`,
        JSON.stringify(checkpoint),
        this.ttl,
      );

      // 保存 metadata
      if (metadata) {
        await this.redisProvider.set(
          `checkpoint:metadata:${threadId}:${checkpointId}`,
          JSON.stringify(metadata),
          this.ttl,
        );
      }

      // 更新 latest pointer
      await this.redisProvider.set(
        `checkpoint:latest:${threadId}`,
        checkpointId,
        this.ttl,
      );

      // 添加到 thread sorted set（按时间戳排序）
      const score = new Date(checkpoint.ts).getTime();
      await this.redisProvider.zadd(`thread:${threadId}`, score, checkpointId);

      return {
        configurable: { thread_id: threadId, checkpoint_id: checkpointId },
      };
    } catch (err) {
      this.logger.error(`put failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * 保存 intermediate writes
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    if (!this.redisProvider.isEnabled()) {
      return this.fallbackSaver.putWrites(config, writes, taskId);
    }

    const threadId = config.configurable?.thread_id as string;
    const checkpointId = config.configurable?.checkpoint_id as string;

    if (!threadId || !checkpointId) {
      return;
    }

    try {
      // 保存每个 write
      for (const [idx, write] of writes.entries()) {
        const pendingWrite = [taskId, ...write];
        await this.redisProvider.set(
          `writes:${threadId}:${checkpointId}:${taskId}:${idx}`,
          JSON.stringify(pendingWrite),
          this.ttl,
        );
      }
    } catch (err) {
      this.logger.warn(`putWrites failed: ${(err as Error).message}`);
    }
  }

  /**
   * 删除指定 thread 的所有 checkpoints
   */
  async deleteThread(threadId: string): Promise<void> {
    if (!this.redisProvider.isEnabled()) {
      await this.fallbackSaver.deleteThread(threadId);
      return;
    }

    try {
      // 获取所有 checkpoint IDs
      const checkpointIds = await this.redisProvider.zrange(
        `thread:${threadId}`,
        0,
        -1,
      );

      // 删除每个 checkpoint 的数据
      for (const checkpointId of checkpointIds) {
        await this.redisProvider.del(`checkpoint:${threadId}:${checkpointId}`);
        await this.redisProvider.del(
          `checkpoint:metadata:${threadId}:${checkpointId}`,
        );
      }

      // 删除 thread sorted set
      await this.redisProvider.del(`thread:${threadId}`);

      // 删除 latest pointer
      await this.redisProvider.del(`checkpoint:latest:${threadId}`);

      this.logger.log(`Deleted thread: ${threadId}`);
    } catch (err) {
      this.logger.warn(`deleteThread failed: ${(err as Error).message}`);
    }
  }

  /**
   * 获取 checkpoint 的 pending writes
   */
  private async getPendingWrites(
    threadId: string,
    checkpointId: string,
  ): Promise<Array<[string, string, unknown]>> {
    try {
      // 使用 pattern 查找所有 writes
      const pattern = `writes:${threadId}:${checkpointId}:*`;
      const keys = await this.redisProvider.keys(pattern);

      const writes: Array<[string, string, unknown]> = [];
      for (const key of keys) {
        const json = await this.redisProvider.get(key);
        if (json) {
          writes.push(JSON.parse(json) as [string, string, unknown]);
        }
      }

      return writes;
    } catch (err) {
      this.logger.warn(`getPendingWrites failed: ${(err as Error).message}`);
      return [];
    }
  }
}
