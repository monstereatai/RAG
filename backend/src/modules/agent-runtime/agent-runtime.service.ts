import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SkillsService } from '../skills/skills.service';
import type { AgentRuntimeMode, AgentRuntimePlan, AgentRuntimeStage, FailureOnset } from './agent-runtime.types';

@Injectable()
export class AgentRuntimeService {
  private readonly roles = [
    { id: 'planner', name: 'Planner', description: '拆解目标、建立依赖和执行边界。' },
    { id: 'researcher', name: 'Researcher', description: '检索知识、调用工具并整理证据。' },
    { id: 'coder', name: 'Coder', description: '根据结构化上下文生成或修改代码。' },
    { id: 'critic', name: 'Critic', description: '检查事实、约束、风险和交付质量。' },
    { id: 'writer', name: 'Writer', description: '将中间结果整理为结构化交付物。' },
    { id: 'tester', name: 'Tester', description: '生成验证步骤、测试用例和回归结论。' },
  ];

  constructor(private readonly skills: SkillsService) {}

  async createPlan(input: { objective: string; mode: AgentRuntimeMode; skillLimit?: number }): Promise<AgentRuntimePlan> {
    const objective = input.objective.trim();
    const matchedSkills = await this.skills.match(objective, input.skillLimit ?? 3);
    const isCodeTask = /代码|实现|开发|修复|重构|接口|组件|工程|bug|code|implement|fix/i.test(objective);
    const isValidationTask = /测试|验收|回归|验证|质量|风险|test|review|check/i.test(objective);
    const stages = this.stagesFor(input.mode, isCodeTask, isValidationTask);
    return {
      planId: `plan_${randomUUID()}`,
      mode: input.mode,
      objective,
      stages,
      selectedSkills: matchedSkills.map((skill) => skill.name),
      contextPolicy: this.contextPolicy(input.mode),
      limits: this.limits(input.mode),
    };
  }

  capabilities() {
    return {
      roles: this.roles,
      modes: ['simple', 'auto', 'agentic', 'production'],
      execution: ['inline', 'parallel', 'checkpointed'],
      controls: ['max_steps', 'max_tool_calls', 'max_delegations', 'timeout', 'budget', 'idempotency'],
      context: ['write', 'select', 'compress', 'isolate'],
      note: 'Runtime 只生成受控执行计划，不执行后台上传的任意代码。',
    };
  }

  analyzeFailureOnset(events: Array<{ sequence?: number; eventType: string; actor?: string; target?: string; payload?: unknown }>): FailureOnset {
    const failure = events.find((event) => this.isFailureEvent(event.eventType));
    if (!failure) return { found: false, recommendation: '未发现明确失败事件，可继续检查最终状态和模型输出。' };
    const payload = failure.payload && typeof failure.payload === 'object' ? failure.payload as Record<string, unknown> : {};
    const reason = String(payload.error ?? payload.reason ?? payload.message ?? '运行事件标记为失败');
    return {
      found: true,
      sequence: failure.sequence,
      eventType: failure.eventType,
      actor: failure.actor,
      target: failure.target,
      reason: reason.slice(0, 500),
      recommendation: this.recommendation(failure.eventType),
    };
  }

  private stagesFor(mode: AgentRuntimeMode, isCodeTask: boolean, isValidationTask: boolean): AgentRuntimeStage[] {
    if (mode === 'simple') return [{ id: 'answer', role: 'writer', description: '执行快速检索并生成回答。', dependsOn: [], execution: 'inline' as const }];
    if (mode === 'auto') return [
      { id: 'fast_path', role: 'researcher', description: '复用快速检索结果并计算充分性。', dependsOn: [], execution: 'inline' as const },
      { id: 'route', role: 'planner', description: '根据证据和任务复杂度决定继续或升级。', dependsOn: ['fast_path'], execution: 'inline' as const },
      { id: 'answer', role: 'writer', description: '生成回答或交给 Agentic 计划。', dependsOn: ['route'], execution: 'checkpointed' as const },
    ];
    if (mode === 'production') return [
      { id: 'requirements', role: 'planner', description: '整理需求、范围和岗位依赖。', dependsOn: [], execution: 'checkpointed' as const },
      { id: 'role_tasks', role: 'researcher', description: '按岗位并行检索并生成阶段产物。', dependsOn: ['requirements'], execution: 'parallel' as const },
      { id: 'review', role: 'critic', description: '执行证据、风险和审批检查。', dependsOn: ['role_tasks'], execution: 'checkpointed' as const },
      { id: 'delivery', role: 'writer', description: '汇总 Artifact 和可运行项目交付物。', dependsOn: ['review'], execution: 'checkpointed' as const },
    ];
    const stages: AgentRuntimeStage[] = [
      { id: 'plan', role: 'planner', description: '拆分子问题并生成依赖图。', dependsOn: [], execution: 'checkpointed' as const },
      { id: 'research', role: 'researcher', description: '并行执行混合检索、图谱和联网补充。', dependsOn: ['plan'], execution: 'parallel' as const },
    ];
    if (isCodeTask) stages.push({ id: 'code', role: 'coder', description: '基于结构化上下文生成或修改代码。', dependsOn: ['research'], execution: 'checkpointed' as const });
    stages.push({ id: 'review', role: isValidationTask ? 'tester' : 'critic', description: isValidationTask ? '执行测试、回归和验收检查。' : '检查引用、事实和风险。', dependsOn: [isCodeTask ? 'code' : 'research'], execution: 'checkpointed' as const });
    stages.push({ id: 'answer', role: 'writer', description: '汇总证据和结构化交付物。', dependsOn: ['review'], execution: 'checkpointed' as const });
    return stages;
  }

  private contextPolicy(mode: AgentRuntimeMode) {
    const policies = {
      simple: { maxHistoryTurns: 5, maxContextCharacters: 12000, compressionThreshold: 10000, isolatedByThread: true },
      auto: { maxHistoryTurns: 5, maxContextCharacters: 18000, compressionThreshold: 14000, isolatedByThread: true },
      agentic: { maxHistoryTurns: 8, maxContextCharacters: 30000, compressionThreshold: 24000, isolatedByThread: true },
      production: { maxHistoryTurns: 3, maxContextCharacters: 24000, compressionThreshold: 18000, isolatedByThread: true },
    };
    return policies[mode];
  }

  private limits(mode: AgentRuntimeMode) {
    return mode === 'simple'
      ? { maxSteps: 3, maxToolCalls: 4, maxDelegations: 0 }
      : mode === 'auto'
        ? { maxSteps: 8, maxToolCalls: 10, maxDelegations: 2 }
        : mode === 'production'
          ? { maxSteps: 18, maxToolCalls: 24, maxDelegations: 6 }
          : { maxSteps: 18, maxToolCalls: 24, maxDelegations: 6 };
  }

  private isFailureEvent(eventType: string) {
    return /failed|blocked|denied|error|budget\.exceeded|tool\.unknown/.test(eventType);
  }

  private recommendation(eventType: string) {
    if (eventType.includes('policy') || eventType.includes('denied')) return '检查工具权限、插件白名单和审批状态。';
    if (eventType.includes('budget')) return '检查最大步数、工具次数、委派次数和成本预算。';
    if (eventType.includes('tool')) return '检查工具输入、超时、幂等键和降级策略。';
    return '检查该事件前的检索证据、上下文快照和模型输出。';
  }
}
