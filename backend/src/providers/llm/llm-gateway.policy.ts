import { ConfigService } from '@nestjs/config';
import { LlmModelProvider } from './llm-provider.interface';

export type LlmTask = 'fast' | 'reasoning' | 'structured' | 'embedding';

export interface LlmRoutePolicy {
  task: LlmTask;
  primary: LlmModelProvider;
  fallback: LlmModelProvider | null;
  timeoutMs: number;
  maxTokens: number;
  maxCostUsd: number;
}

/**
 * 代码级模型网关策略：统一做任务路由、fallback、超时、输出上限和成本预算。
 * 真正的模型调用仍由现有 provider 负责，避免业务代码直接绑定厂商 SDK。
 */
export class LlmGatewayPolicy {
  constructor(private readonly config: ConfigService) {}

  resolve(task: LlmTask = 'fast', requested?: LlmModelProvider): LlmRoutePolicy {
    const primary = requested ?? this.defaultProvider();
    const fallback = this.fallbackProvider(primary);
    const prefix = task === 'reasoning' || task === 'structured' ? 'LLM_REASONING' : 'LLM_FAST';
    return {
      task,
      primary,
      fallback,
      timeoutMs: this.number(`${prefix}_TIMEOUT_MS`, primary === 'qwen' ? 60000 : 30000),
      maxTokens: this.number(`${prefix}_MAX_TOKENS`, task === 'fast' ? 2048 : 4096),
      maxCostUsd: this.number(`${prefix}_MAX_COST_USD`, 0.05),
    };
  }

  private defaultProvider(): LlmModelProvider {
    return this.config.get<string>('llm.provider') === 'deepseek' ? 'deepseek' : 'qwen';
  }

  private fallbackProvider(primary: LlmModelProvider): LlmModelProvider | null {
    if (this.config.get<boolean>('llm.gateway.fallbackEnabled') === false) return null;
    const configured = this.config.get<string>('llm.gateway.fallbackProvider');
    const fallback = configured === 'deepseek' || configured === 'qwen' ? configured : primary === 'qwen' ? 'deepseek' : 'qwen';
    return fallback === primary ? null : fallback;
  }

  private number(key: string, fallback: number): number {
    const value = Number(this.config.get<number>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
