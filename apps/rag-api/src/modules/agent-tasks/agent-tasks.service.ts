import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import { AgentTaskEntity } from '../../providers/db/entities/agent-task.entity';
import { type ProductionRole } from '../workflow/production-workflow.state';
import { dependenciesForProductionRole } from '../workflow/production-workflow.plan';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';

@Injectable()
export class AgentTasksService {
  private retryHandler?: (task: AgentTaskEntity) => Promise<void>;

  constructor(
    @InjectRepository(AgentTaskEntity)
    private readonly tasks: Repository<AgentTaskEntity>,
    private readonly events: AgentRuntimeEventsService,
  ) {}

  registerRetryHandler(
    handler: (task: AgentTaskEntity) => Promise<void>,
  ): void {
    this.retryHandler = handler;
  }

  async createCodingTask(
    input: {
      id: string;
      threadId: string;
      runId: string;
      tenantId: string;
      ownerUserId: string;
      requestId: string;
      requestHash: string;
      artifactId: string;
      instruction: string;
    },
    transactionManager: EntityManager,
  ): Promise<AgentTaskEntity> {
    const repository = transactionManager.getRepository(AgentTaskEntity);
    return repository.save(
      repository.create({
        id: input.id,
        threadId: input.threadId,
        runId: input.runId,
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        requestId: input.requestId,
        requestHash: input.requestHash,
        taskType: 'coding_task',
        role: 'coding_agent',
        title: 'Workspace Coding Task',
        description: '异步 ZIP 工作区 Coding 任务',
        processType: 'async',
        status: 'queued',
        dependsOnTaskIds: '[]',
        inputArtifactIds: JSON.stringify([input.artifactId]),
        outputArtifactId: null,
        approvalRequired: false,
        retryCount: 0,
        resultSummary: null,
        errorMessage: null,
        codingContext: JSON.stringify({
          source: 'zip',
          artifactId: input.artifactId,
          instruction: input.instruction,
        }),
        verification: null,
        lastCompletedStep: 0,
      }),
    );
  }

  async findCodingTaskByRequest(input: {
    tenantId: string;
    ownerUserId: string;
    requestId: string;
  }): Promise<AgentTaskEntity | null> {
    return this.tasks.findOne({
      where: {
        taskType: 'coding_task',
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        requestId: input.requestId,
      },
    });
  }

  async findOwnedCodingTask(
    id: string,
    ownerUserId: string,
    tenantId: string,
    threadId?: string,
  ): Promise<AgentTaskEntity> {
    const task = await this.tasks.findOne({
      where: {
        id,
        taskType: 'coding_task',
        ownerUserId,
        tenantId,
        ...(threadId ? { threadId } : {}),
      },
    });
    if (!task) throw new NotFoundException(`coding task ${id} not found`);
    return task;
  }

  async updateCodingTask(
    id: string,
    input: Partial<
      Pick<
        AgentTaskEntity,
        | 'status'
        | 'retryCount'
        | 'resultSummary'
        | 'errorMessage'
        | 'verification'
        | 'lastCompletedStep'
        | 'outputArtifactId'
      >
    >,
    transactionManager?: EntityManager,
  ): Promise<AgentTaskEntity> {
    const repository = transactionManager?.getRepository(AgentTaskEntity) ?? this.tasks;
    const result = await repository.update(
      { id, taskType: 'coding_task' },
      input,
    );
    if (result.affected !== 1) {
      throw new ConflictException('Coding task state changed before update');
    }
    const task = await repository.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`coding task ${id} not found`);
    return task;
  }

  async ensureCodingTaskEvent(
    task: AgentTaskEntity,
    eventType: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    await this.events.emit({
      tenantId: task.tenantId ?? 'legacy',
      threadId: task.threadId,
      runId: task.runId ?? undefined,
      taskId: task.id,
      eventType,
      actor: 'coding_agent',
      target: 'coding_agent',
      payload,
      idempotencyKey,
    });
  }

  async markRetryFailed(id: string, error: unknown): Promise<void> {
    const task = await this.findById(id);
    task.status = 'failed';
    task.errorMessage =
      error instanceof Error ? error.message.slice(0, 2_000) : String(error);
    await this.tasks.save(task);
    await this.events.emit({
      threadId: task.threadId,
      taskId: task.id,
      eventType: 'task.failed',
      actor: task.role,
      target: task.role,
      payload: { error: task.errorMessage, retryCount: task.retryCount },
    });
  }

  async createPlan(input: {
    threadId: string;
    roles: ProductionRole[];
    processType?: 'sequential' | 'hierarchical' | 'conditional';
    runId?: string;
  }, transactionManager?: EntityManager) {
    const repository = transactionManager?.getRepository(AgentTaskEntity) ?? this.tasks;
    const ids = new Map<ProductionRole, string>();
    const parentTaskId =
      input.processType === 'hierarchical' ? randomUUID() : null;
    const rows = input.roles.map((role) => {
      const id = randomUUID();
      ids.set(role, id);
      return repository.create({
        id,
        threadId: input.threadId,
        runId: input.runId ?? null,
        parentTaskId,
        role,
        title: `${role} Agent Task`,
        description: `${role} 岗位结构化交付任务`,
        processType: input.processType ?? 'sequential',
        status: 'pending',
        dependsOnTaskIds: '[]',
        inputArtifactIds: '[]',
        approvalRequired: false,
        retryCount: 0,
      });
    });
    for (const row of rows) {
      const dependencies = dependenciesForProductionRole(
        row.role as ProductionRole,
        input.roles,
      )
        .map((role) => ids.get(role))
        .filter((id): id is string => Boolean(id));
      row.dependsOnTaskIds = JSON.stringify(dependencies);
    }
    if (parentTaskId) {
      const manager = repository.create({
        id: parentTaskId,
        threadId: input.threadId,
        runId: input.runId ?? null,
        parentTaskId: null,
        role: 'manager',
        title: 'Manager Agent Task',
        description: '受控拆解、委派、汇总和冲突检查',
        processType: 'hierarchical',
        status: 'running',
        dependsOnTaskIds: '[]',
        inputArtifactIds: '[]',
        approvalRequired: true,
        retryCount: 0,
      });
      const saved = await repository.save([manager, ...rows]);
      if (!transactionManager) await this.ensurePlanCreatedEvent({
        threadId: input.threadId,
        processType: input.processType,
        taskCount: saved.length,
      });
      return saved;
    }
    const saved = await repository.save(rows);
    if (!transactionManager) await this.ensurePlanCreatedEvent({
      threadId: input.threadId,
      processType: input.processType,
      taskCount: saved.length,
    });
    return saved;
  }

  async ensurePlanCreatedEvent(input: {
    threadId: string;
    processType?: string;
    taskCount: number;
  }): Promise<void> {
    await this.events.emit({
      threadId: input.threadId,
      eventType: 'task.created',
      actor: 'workflow',
      target: input.processType === 'hierarchical' ? 'manager' : undefined,
      payload: { processType: input.processType ?? 'sequential', taskCount: input.taskCount },
      idempotencyKey: `workflow-task-plan:${input.threadId}`,
    });
  }

  async list(threadId?: string) {
    return this.tasks.find({
      where: threadId ? { threadId } : {},
      order: { createdAt: 'ASC' },
      take: 500,
    });
  }

  async findById(id: string) {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`task ${id} not found`);
    return task;
  }

  async updateForRole(
    threadId: string,
    role: string,
    input: {
      status: string;
      summary?: string;
      outputArtifactId?: string;
      approvalRequired?: boolean;
      errorMessage?: string;
    },
  ) {
    const task = await this.tasks.findOne({
      where: { threadId, role },
      order: { createdAt: 'DESC' },
    });
    if (!task) return null;
    Object.assign(task, input);
    const saved = await this.tasks.save(task);
    await this.events.emit({
      threadId,
      taskId: task.id,
      eventType: `task.${input.status === 'failed' ? 'failed' : input.status === 'completed' ? 'completed' : 'updated'}`,
      actor: task.role,
      target: task.role,
      payload: {
        status: task.status,
        outputArtifactId: task.outputArtifactId,
        summary: task.resultSummary,
      },
    });
    return saved;
  }

  async delegate(input: {
    threadId: string;
    runId?: string;
    parentTaskId?: string;
    role: string;
    title: string;
    description: string;
    processType?: string;
    dependsOnTaskIds?: string[];
  }) {
    const task = await this.tasks.save(
      this.tasks.create({
        id: randomUUID(),
        threadId: input.threadId,
        runId: input.runId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        role: input.role,
        title: input.title,
        description: input.description,
        processType: input.processType ?? 'hierarchical',
        status: 'pending',
        dependsOnTaskIds: JSON.stringify(input.dependsOnTaskIds ?? []),
        inputArtifactIds: '[]',
        approvalRequired: false,
        retryCount: 0,
      }),
    );
    await this.events.emit({
      threadId: input.threadId,
      taskId: task.id,
      eventType: 'task.delegated',
      actor: 'manager',
      target: input.role,
      payload: { parentTaskId: input.parentTaskId, title: input.title },
    });
    return task;
  }

  async retry(id: string) {
    const task = await this.findById(id);
    if (task.taskType === 'coding_task') {
      throw new ConflictException(
        'Coding tasks must use the Coding Task resume endpoint.',
      );
    }
    if (task.status !== 'failed') {
      throw new Error(`task ${id} is not retryable from ${task.status}`);
    }
    task.status = 'pending';
    task.retryCount += 1;
    task.errorMessage = null;
    const saved = await this.tasks.save(task);
    await this.events.emit({
      threadId: task.threadId,
      taskId: task.id,
      eventType: 'task.retry',
      actor: task.role,
      target: task.role,
      payload: { retryCount: task.retryCount },
    });
    if (this.retryHandler) {
      void this.retryHandler(saved).catch(async (error: unknown) => {
        await this.markRetryFailed(saved.id, error);
      });
    }
    return saved;
  }

  async snapshot(threadId: string) {
    return { threadId, tasks: await this.list(threadId) };
  }
}
