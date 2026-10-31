import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { getPromptVersion } from '../prompts/prompt-registry';
import { supervisorAgentPromptDefinitions } from './agent-prompts';
import type { ISubAgent, AgentInput, AgentOutput } from './agent.interface';

/**
 * Critic Agent — 评审质检
 *
 * 职责：对 Writer 的输出进行质量检查、逻辑一致性验证、事实核查。
 */
@Injectable()
export class CriticAgent implements ISubAgent {
  readonly name = 'critic';
  readonly role = '评审质检：检查回答的逻辑一致性、事实准确性和完整性';
  private readonly logger = new Logger(CriticAgent.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async execute(input: AgentInput): Promise<AgentOutput> {
    const start = Date.now();
    input.signal?.throwIfAborted();
    const model = this.llmProvider.getModel();

    const systemPrompt = supervisorAgentPromptDefinitions.critic;
    const promptVersion = getPromptVersion('supervisor_agent.critic');

    const userPrompt = [
      `评审任务：审查以下关于「${input.task}」的回答`,
      input.context ? `\n待审查内容：\n${input.context}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const response = await model.invoke(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { signal: input.signal },
      );

      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      // 从评审内容中提取置信度（基于评分）
      const scoreMatch = content.match(/(\d+)\s*[/／]\s*10/);
      const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 7;
      const confidence = Math.min(score / 10, 1);

      this.logger.log(
        `Critic completed in ${Date.now() - start}ms, score=${score}/10`,
      );

      return {
        content,
        agent: this.name,
        confidence,
        durationMs: Date.now() - start,
        promptVersion,
        metadata: { score },
      };
    } catch (err) {
      if (input.signal?.aborted) throw err;
      this.logger.error(`Critic failed: ${(err as Error).message}`);
      return {
        content: `评审阶段失败：${(err as Error).message}`,
        agent: this.name,
        confidence: 0,
        durationMs: Date.now() - start,
        promptVersion,
      };
    }
  }
}
