import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { ISubAgent, AgentInput, AgentOutput } from './agent.interface';

/**
 * Researcher Agent — 信息检索与收集
 *
 * 职责：根据任务描述进行多角度信息检索，整合并归纳出核心事实。
 * 在多 Agent 管线中通常作为第一阶段。
 */
@Injectable()
export class ResearcherAgent implements ISubAgent {
  readonly name = 'researcher';
  readonly role =
    '信息检索与收集：从知识库和上下文中提取与任务相关的核心事实和数据';
  private readonly logger = new Logger(ResearcherAgent.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async execute(input: AgentInput): Promise<AgentOutput> {
    const start = Date.now();
    const model = this.llmProvider.getModel();

    const systemPrompt = `你是一个专业的信息研究员。你的任务是根据提供的上下文和问题，提取所有相关的事实、数据和关键信息。
要求：
1. 列出所有与问题相关的事实要点
2. 标注信息来源（如果上下文中有）
3. 识别信息缺口（哪些方面缺乏数据）
4. 保持客观，不做推测`;

    const userPrompt = [
      `任务：${input.task}`,
      input.context ? `\n上下文：\n${input.context}` : '',
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
        `Researcher completed in ${Date.now() - start}ms, output length=${content.length}`,
      );

      return {
        content,
        agent: this.name,
        confidence: 0.8,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      this.logger.error(`Researcher failed: ${(err as Error).message}`);
      return {
        content: `研究阶段失败：${(err as Error).message}`,
        agent: this.name,
        confidence: 0,
        durationMs: Date.now() - start,
      };
    }
  }
}
