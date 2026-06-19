import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { ISubAgent, AgentInput, AgentOutput } from './agent.interface';

/**
 * Analyst Agent — 分析推理
 *
 * 职责：对 Researcher 收集的信息进行深度分析、推理、对比和总结。
 */
@Injectable()
export class AnalystAgent implements ISubAgent {
  readonly name = 'analyst';
  readonly role = '分析推理：对收集到的信息进行深度分析、对比和逻辑推理';
  private readonly logger = new Logger(AnalystAgent.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async execute(input: AgentInput): Promise<AgentOutput> {
    const start = Date.now();
    const model = this.llmProvider.getModel();

    const systemPrompt = `你是一个专业的分析师。你的任务是对提供的研究数据进行深度分析。
要求：
1. 识别数据中的模式和趋势
2. 进行因果推理和逻辑分析
3. 对比不同观点或方案的优劣
4. 给出有依据的分析结论
5. 标注分析中的不确定性`;

    const userPrompt = [
      `分析任务：${input.task}`,
      input.context ? `\n研究数据：\n${input.context}` : '',
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
        `Analyst completed in ${Date.now() - start}ms, output length=${content.length}`,
      );

      return {
        content,
        agent: this.name,
        confidence: 0.85,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      this.logger.error(`Analyst failed: ${(err as Error).message}`);
      return {
        content: `分析阶段失败：${(err as Error).message}`,
        agent: this.name,
        confidence: 0,
        durationMs: Date.now() - start,
      };
    }
  }
}
