import { BadRequestException } from '@nestjs/common';

export type ProductionRoleAgentRole = 'frontend' | 'backend' | 'qa';
export type ProductionRoleAgentTask = 'code' | 'verify';

export interface ProductionRoleAgentPlan {
  role: ProductionRoleAgentRole;
  task: ProductionRoleAgentTask;
  execution: 'coding' | 'testing';
}

export function resolveProductionRoleAgentPlan(input: {
  role?: string;
  task?: string;
}): ProductionRoleAgentPlan {
  if (input.role === undefined && input.task === undefined) {
    return { role: 'frontend', task: 'code', execution: 'coding' };
  }
  if (input.role === 'frontend' && input.task === 'code') {
    return { role: 'frontend', task: 'code', execution: 'coding' };
  }
  if (input.role === 'backend' && input.task === 'code') {
    return { role: 'backend', task: 'code', execution: 'coding' };
  }
  if (input.role === 'qa' && input.task === 'verify') {
    return { role: 'qa', task: 'verify', execution: 'testing' };
  }
  throw new BadRequestException('岗位与任务类型组合无效。');
}
