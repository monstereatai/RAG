import { Injectable } from '@nestjs/common';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';

export type AgentGoalStatus = 'active' | 'paused' | 'blocked' | 'completed';

export interface AgentGoalSnapshot {
  objective: string;
  status: AgentGoalStatus;
  round: number;
  maxRounds: number;
  reason?: string;
  updatedAt: string;
}

@Injectable()
export class AgentGoalService {
  constructor(private readonly events: AgentRuntimeEventsService) {}

  async activate(input: {
    threadId: string;
    runId?: string;
    actor: string;
    objective: string;
    maxRounds: number;
  }) {
    return this.emit(input, 'active');
  }

  async update(input: {
    threadId: string;
    runId?: string;
    actor: string;
    objective: string;
    maxRounds: number;
    status: AgentGoalStatus;
    round?: number;
    reason?: string;
  }) {
    return this.emit(input, input.status, input.round, input.reason);
  }

  async get(runId: string): Promise<AgentGoalSnapshot | null> {
    const events = await this.events.list(undefined, runId);
    const goalEvents = events.filter((event) =>
      event.eventType.startsWith('goal.'),
    );
    const latest = goalEvents.at(-1);
    if (!latest) return null;
    const payload = latest.payload as Partial<AgentGoalSnapshot>;
    return {
      objective: String(payload.objective ?? ''),
      status: (payload.status ??
        latest.eventType.replace('goal.', '')) as AgentGoalStatus,
      round: Number(payload.round ?? 1),
      maxRounds: Number(payload.maxRounds ?? 1),
      reason: typeof payload.reason === 'string' ? payload.reason : undefined,
      updatedAt: latest.createdAt.toISOString(),
    };
  }

  private async emit(
    input: {
      threadId: string;
      runId?: string;
      actor: string;
      objective: string;
      maxRounds: number;
      status?: AgentGoalStatus;
      round?: number;
      reason?: string;
    },
    status: AgentGoalStatus,
    round = 1,
    reason?: string,
  ) {
    return this.events.emit({
      threadId: input.threadId,
      runId: input.runId,
      eventType: `goal.${status}`,
      actor: input.actor,
      payload: {
        objective: input.objective,
        status,
        round,
        maxRounds: input.maxRounds,
        ...(reason ? { reason } : {}),
      },
    });
  }
}
