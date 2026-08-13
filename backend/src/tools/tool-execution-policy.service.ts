import { Injectable } from '@nestjs/common';
import { toolRegistry, type ToolRegistryEntry } from './tool-registry';

export interface ToolExecutionContext {
  mode: 'simple' | 'auto' | 'agentic' | 'production';
  role?: string;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  entry?: ToolRegistryEntry;
}

@Injectable()
export class ToolExecutionPolicyService {
  decide(toolName: string, context: ToolExecutionContext): ToolPolicyDecision {
    const entry = toolRegistry.find((item) => item.name === toolName);
    if (!entry) {
      return { allowed: false, requiresApproval: false, reason: '工具未在 Tool Registry 注册，按默认拒绝策略阻断。' };
    }
    if (!entry.modes.includes(context.mode)) {
      return { allowed: false, entry, requiresApproval: false, reason: `工具不允许在 ${context.mode} 链路执行。` };
    }
    if (entry.roles?.length && (!context.role || !entry.roles.includes(context.role))) {
      return { allowed: false, entry, requiresApproval: false, reason: `工具不允许由 ${context.role ?? '未声明岗位'} 使用。` };
    }
    return {
      allowed: true,
      entry,
      requiresApproval: Boolean(entry.requiresApproval),
      reason: entry.requiresApproval ? '工具已授权，但写入类动作需在产物生成阶段接受审计。' : '工具已通过最小权限校验。',
    };
  }
}
