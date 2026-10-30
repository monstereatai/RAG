import { Injectable } from '@nestjs/common';
import { toolRegistry, type ToolRegistryEntry } from './tool-registry';

export interface ToolExecutionContext {
  mode: 'simple' | 'auto' | 'agentic' | 'production';
  role?: string;
  /** 工作流插件组合解析后的工具白名单；未传时保持既有 Tool Registry 默认行为。 */
  allowedToolNames?: string[];
  pluginKeys?: string[];
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
      return {
        allowed: false,
        requiresApproval: false,
        reason: '工具未在 Tool Registry 注册，按默认拒绝策略阻断。',
      };
    }
    if (!Number.isFinite(entry.timeoutMs) || entry.timeoutMs <= 0) {
      return {
        allowed: false,
        entry,
        requiresApproval: false,
        reason: `工具 ${toolName} 的 timeoutMs 配置无效，按默认拒绝策略阻断。`,
      };
    }
    if (!entry.modes.includes(context.mode)) {
      return {
        allowed: false,
        entry,
        requiresApproval: false,
        reason: `工具不允许在 ${context.mode} 链路执行。`,
      };
    }
    if (
      context.pluginKeys?.length &&
      !context.allowedToolNames?.includes(toolName)
    ) {
      return {
        allowed: false,
        entry,
        requiresApproval: false,
        reason: `当前插件组合（${context.pluginKeys?.join('、') || '未命名'}）未授权工具 ${toolName}。`,
      };
    }
    if (
      entry.roles?.length &&
      (!context.role || !entry.roles.includes(context.role))
    ) {
      return {
        allowed: false,
        entry,
        requiresApproval: false,
        reason: `工具不允许由 ${context.role ?? '未声明岗位'} 使用。`,
      };
    }
    return {
      allowed: true,
      entry,
      // 写权限和高风险标签都必须经过审批；即使未来漏配 requiresApproval 也默认保护。
      requiresApproval: Boolean(
        entry.requiresApproval ||
          entry.permission === 'write' ||
          entry.risk === 'high',
      ),
      reason:
        entry.requiresApproval ||
        entry.permission === 'write' ||
        entry.risk === 'high'
          ? '工具已授权，但其写入权限或高风险标记要求经过执行审批门禁。'
          : '工具已通过最小权限校验。',
    };
  }
}
