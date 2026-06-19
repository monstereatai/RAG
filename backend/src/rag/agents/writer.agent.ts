import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { ISubAgent, AgentInput, AgentOutput } from './agent.interface';

/**
 * Writer Agent — 撰写生成
 *
 * 职责：基于分析结果撰写结构化、可读性强的最终回答。
 */
@Injectable()
export class WriterAgent implements ISubAgent {
  readonly name = 'writer';
  readonly role = '撰写生成：基于分析结果撰写结构化、可读性强的回答';
  private readonly logger = new Logger(WriterAgent.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async execute(input: AgentInput): Promise<AgentOutput> {
    const start = Date.now();
    const model = this.llmProvider.getModel();

    const systemPrompt = `你是一个专业的技术写作者。你的任务是基于分析结果撰写清晰、结构化的回答。
要求：
1. 使用清晰的标题和段落结构
2. 核心观点放在开头（倒金字塔结构）
3. 用具体数据和引用支撑论点
4. 使用恰当的过渡词保持逻辑流畅
5. 结尾给出简洁的总结或建议`;

    const userPrompt = [
      `写作任务：${input.task}`,
      input.context ? `\n分析素材：\n${input.context}` : '',
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

      this.logger.log(
        `Writer completed in ${Date.now() - start}ms, output length=${content.length}`,
      );

      return {
        content,
        agent: this.name,
        confidence: 0.9,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      this.logger.error(`Writer failed: ${(err as Error).message}`);
      return {
        content: `撰写阶段失败：${(err as Error).message}`,
        agent: this.name,
        confidence: 0,
        durationMs: Date.now() - start,
      };
    }
  }
}
