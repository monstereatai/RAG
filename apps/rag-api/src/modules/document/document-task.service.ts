import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { DocumentTaskEntity } from '../../providers/db/entities/document-task.entity';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import { DocumentQueueService } from './document-queue.service';

/** Owns persisted document-task state and its queue lifecycle. */
@Injectable()
export class DocumentTaskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentTaskService.name);
  private staleTaskReaper?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(DocumentTaskEntity)
    private readonly taskRepo: Repository<DocumentTaskEntity>,
    private readonly documentQueueService: DocumentQueueService,
    @Optional() private readonly dingTalk?: DingTalkProvider,
  ) {}

  onModuleInit(): void {
    if (!this.documentQueueService.enabled) return;
    this.staleTaskReaper = setInterval(
      () => {
        void this.failOrphanedQueuedTasks();
      },
      5 * 60 * 1000,
    );
    this.staleTaskReaper.unref?.();
  }

  onModuleDestroy(): void {
    if (this.staleTaskReaper) clearInterval(this.staleTaskReaper);
  }

  createQueuedTask(
    filename: string,
    userId: string,
    tenantId?: string,
  ): Promise<DocumentTaskEntity> {
    const task = this.taskRepo.create({
      id: randomUUID(),
      filename,
      userId,
      tenantId: tenantId ?? 'legacy',
      status: 'queued',
      stage: 'queued',
      progress: 0,
    });
    return this.taskRepo.save(task);
  }

  getTask(taskId: string, userId: string): Promise<DocumentTaskEntity | null> {
    return this.taskRepo.findOne({ where: { id: taskId, userId } });
  }

  async getPendingTasks(limit = 50) {
    const queueResult = await this.documentQueueService.listPending(limit);
    if (!queueResult.enabled || queueResult.tasks.length === 0) {
      return queueResult;
    }

    const taskIds = queueResult.tasks.map((task) => task.taskId);
    const records = await this.taskRepo.find({ where: { id: In(taskIds) } });
    const tasksById = new Map(records.map((task) => [task.id, task]));
    return {
      enabled: true,
      tasks: queueResult.tasks.flatMap((queuedTask) => {
        const task = tasksById.get(queuedTask.taskId);
        if (!task || task.status !== 'queued') return [];
        return [
          {
            id: task.id,
            filename: task.filename,
            status: task.status,
            queueStatus: queuedTask.status,
            createdAt:
              task.createdAt?.toISOString() ??
              new Date(queuedTask.createdAt).toISOString(),
          },
        ];
      }),
    };
  }

  async cancelQueuedTask(taskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      return { taskId, cancelled: false, reason: '任务记录不存在。' };
    }
    if (task.status !== 'queued') {
      return {
        taskId,
        cancelled: false,
        reason:
          task.status === 'processing'
            ? '任务已处理中，无法中断。'
            : `任务状态为 ${task.status}，无法取消。`,
      };
    }

    const result = await this.documentQueueService.cancelPending(taskId);
    if (!result.cancelled) return result;

    await this.taskRepo.update(
      { id: taskId },
      {
        status: 'cancelled',
        stage: 'cancelled',
        errorMessage:
          result.cleanupScheduled === false && result.cleanupCompleted !== true
            ? result.reason
            : null,
        finishedAt: new Date(),
      },
    );
    return result;
  }

  getFailedTasks(limit = 50): Promise<DocumentTaskEntity[]> {
    return this.taskRepo.find({
      where: { status: 'failed' },
      order: { updatedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async retryFailedTask(taskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task || task.status !== 'failed')
      return { taskId, retried: false, reason: 'failed task not found' };
    const result = await this.documentQueueService.retryFailed(taskId);
    if (result.retried) {
      await this.updateTask(taskId, {
        status: 'queued',
        stage: 'retry_queued',
        progress: 0,
        errorMessage: null,
        finishedAt: null,
      });
    }
    return result;
  }

  async markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
    await this.updateTask(taskId, {
      status: 'failed',
      stage: 'failed',
      progress: 100,
      errorMessage,
      finishedAt: new Date(),
    });
    void this.dingTalk?.notifyAlert(
      `document.failed:${taskId}`,
      `**文档入库任务失败**（taskId：\`${taskId}\`）\n\n错误：${errorMessage.slice(0, 300)}`,
    );
  }

  private async failOrphanedQueuedTasks(): Promise<void> {
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    try {
      const tasks = await this.taskRepo.find({
        where: { status: 'queued', createdAt: LessThan(staleBefore) },
        order: { createdAt: 'ASC' },
        take: 100,
      });
      for (const task of tasks) {
        const state = await this.documentQueueService.getJobState(task.id);
        if (state === null) {
          await this.markTaskFailed(
            task.id,
            '任务记录已创建，但 BullMQ 中没有对应任务；上传文件内容未持久化，无法自动恢复，请重新上传。',
          );
        } else if (state === 'failed') {
          await this.markTaskFailed(
            task.id,
            'BullMQ 文档处理任务已最终失败，请检查队列错误并重新上传或重试。',
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `stale queued document task scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async upsertTask(
    taskId: string,
    patch: Partial<DocumentTaskEntity>,
  ): Promise<void> {
    const existing = await this.taskRepo.findOne({ where: { id: taskId } });
    if (existing) {
      await this.taskRepo.update({ id: taskId }, patch);
      return;
    }
    await this.taskRepo.save(
      this.taskRepo.create({
        id: taskId,
        filename: patch.filename ?? 'unknown',
        userId: patch.userId ?? null,
        docId: patch.docId ?? null,
        status: patch.status ?? 'queued',
        stage: patch.stage ?? 'queued',
        progress: patch.progress ?? 0,
        startedAt: patch.startedAt ?? null,
      }),
    );
  }

  async updateTask(
    taskId: string,
    patch: Partial<DocumentTaskEntity>,
  ): Promise<void> {
    await this.taskRepo.update({ id: taskId }, patch);
  }
}
