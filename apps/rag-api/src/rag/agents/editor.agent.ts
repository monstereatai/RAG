import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { getPromptVersion } from '../prompts/prompt-registry';
import { supervisorAgentPromptDefinitions } from './agent-prompts';
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
    input.signal?.throwIfAborted();
    const model = this.llmProvider.getModel();

    const systemPrompt = supervisorAgentPromptDefinitions.editor;
    const promptVersion = getPromptVersion('supervisor_agent.editor');

    const userPrompt = [
      `编辑任务：润色关于「${input.task}」的回答`,
      input.context ? `\n原文及评审意见：\n${input.context}` : '',
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

      this.logger.log(
        `Editor completed in ${Date.now() - start}ms, output length=${content.length}`,
      );

      return {
        content,
        agent: this.name,
        confidence: 0.95,
        durationMs: Date.now() - start,
        promptVersion,
      };
    } catch (err) {
      if (input.signal?.aborted) throw err;
      this.logger.error(`Editor failed: ${(err as Error).message}`);
      return {
        content: `编辑阶段失败：${(err as Error).message}`,
        agent: this.name,
        confidence: 0,
        durationMs: Date.now() - start,
        promptVersion,
      };
    }
  }
}
