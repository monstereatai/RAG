import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
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
    const model = this.llmProvider.getModel();

    const systemPrompt = `你是一个严格的质量评审员。你的任务是对文本内容进行全面质量检查。
要求：
1. 检查逻辑一致性：是否存在自相矛盾
2. 事实准确性：是否有明显的事实错误或无依据的断言
3. 完整性：是否遗漏了关键信息
4. 可读性：结构和表达是否清晰
5. 给出具体的修改建议（如有）
6. 给出总体评分（0-10）和评审结论`;

    const userPrompt = [
      `评审任务：审查以下关于「${input.task}」的回答`,
      input.context ? `\n待审查内容：\n${input.context}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const response = await model.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

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
        metadata: { score },
      };
    } catch (err) {
      this.logger.error(`Critic failed: ${(err as Error).message}`);
      return {
        content: `评审阶段失败：${(err as Error).message}`,
        agent: this.name,
        confidence: 0,
        durationMs: Date.now() - start,
      };
    }
  }
}
