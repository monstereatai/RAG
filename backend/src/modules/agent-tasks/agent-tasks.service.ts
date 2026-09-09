import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AgentTaskEntity } from '../../providers/db/entities/agent-task.entity';
import { type ProductionRole } from '../workflow/production-workflow.state';
import { dependenciesForProductionRole } from '../workflow/production-workflow.plan';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';

@Injectable()
export class AgentTasksService {
  constructor(
    @InjectRepository(AgentTaskEntity)
    private readonly tasks: Repository<AgentTaskEntity>,
    private readonly events: AgentRuntimeEventsService,
  ) {}

  async createPlan(input: {
    threadId: string;
    roles: ProductionRole[];
    processType?: 'sequential' | 'hierarchical' | 'conditional';
    runId?: string;
  }) {
    const ids = new Map<ProductionRole, string>();
    const parentTaskId =
      input.processType === 'hierarchical' ? randomUUID() : null;
    const rows = input.roles.map((role) => {
      const id = randomUUID();
      ids.set(role, id);
      return this.tasks.create({
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
      const manager = this.tasks.create({
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
      const saved = await this.tasks.save([manager, ...rows]);
      await this.events.emit({
        threadId: input.threadId,
        eventType: 'task.created',
        actor: 'workflow',
        target: 'manager',
        payload: { processType: input.processType, taskCount: saved.length },
      });
      return saved;
    }
    const saved = await this.tasks.save(rows);
    await this.events.emit({
      threadId: input.threadId,
      eventType: 'task.created',
      actor: 'workflow',
      payload: {
        processType: input.processType ?? 'sequential',
        taskCount: saved.length,
      },
    });
    return saved;
  }

  async list(threadId?: string) {
    return this.tasks.find({
      where: threadId ? { threadId } : {},
      order: { createdAt: 'ASC' },
      take: 500,
    });
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
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`task ${id} not found`);
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
    return saved;
  }

  async snapshot(threadId: string) {
    return { threadId, tasks: await this.list(threadId) };
  }
}
