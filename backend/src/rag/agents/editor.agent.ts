import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { ISubAgent, AgentInput, AgentOutput } from './agent.interface';

/**
 * Editor Agent — 编辑润色
 *
 * 职责：根据 Critic 的评审意见对内容进行最终修改和润色。
 */
@Injectable()
export class EditorAgent implements ISubAgent {
  readonly name = 'editor';
  readonly role = '编辑润色：根据评审意见对内容进行最终修改和润色';
  private readonly logger = new Logger(EditorAgent.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async execute(input: AgentInput): Promise<AgentOutput> {
    const start = Date.now();
    const model = this.llmProvider.getModel();

    const systemPrompt = `你是一个专业的编辑。你的任务是根据评审意见对文本进行最终修改和润色。
要求：
1. 根据评审意见修正问题
2. 改善语言表达的流畅性和专业性
3. 统一术语和格式
4. 确保内容简洁但不遗漏要点
5. 输出修改后的最终版本（不要输出修改说明，直接输出改好的内容）`;

    const userPrompt = [
      `编辑任务：润色关于「${input.task}」的回答`,
      input.context ? `\n原文及评审意见：\n${input.context}` : '',
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
        `Editor completed in ${Date.now() - start}ms, output length=${content.length}`,
      );

      return {
        content,
        agent: this.name,
        confidence: 0.95,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      this.logger.error(`Editor failed: ${(err as Error).message}`);
      return {
        content: `编辑阶段失败：${(err as Error).message}`,
        agent: this.name,
        confidence: 0,
        durationMs: Date.now() - start,
      };
    }
  }
}
