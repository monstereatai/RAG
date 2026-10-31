import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { getPromptVersion } from '../prompts/prompt-registry';
import { supervisorAgentPromptDefinitions } from './agent-prompts';
import type { ISubAgent, AgentInput, AgentOutput } from './agent.interface';

type DeepAgentFactory = {
  createDeepAgent: (params: {
    model: ReturnType<LlmProvider['getModel']>;
    systemPrompt: string;
    middleware?: unknown[];
  }) => {
    invoke: (
      input: unknown,
      options?: { signal?: AbortSignal },
    ) => Promise<unknown>;
  };
};

type QuickJsMiddlewareFactory = {
  createCodeInterpreterMiddleware: () => unknown;
};

/**
 * Analyst Agent — 分析推理
 *
 * 职责：对 Researcher 收集的信息进行深度分析、推理、对比和总结。
 * 支持使用 `@langchain/quickjs` 沙箱进行数值计算与结构化数据分析。
 */
@Injectable()
export class AnalystAgent implements ISubAgent {
  readonly name = 'analyst';
  readonly role =
    '分析推理：对收集到的信息进行深度分析、对比和逻辑推理，可使用 JS 代码沙箱进行精确数值计算';
  private readonly logger = new Logger(AnalystAgent.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async execute(input: AgentInput): Promise<AgentOutput> {
    const start = Date.now();
    input.signal?.throwIfAborted();
    const model = this.llmProvider.getModel();

    const systemPrompt = supervisorAgentPromptDefinitions.analyst;
    const promptVersion = getPromptVersion('supervisor_agent.analyst');

    const userPrompt = [
      `分析任务：${input.task}`,
      input.context ? `\n研究数据：\n${input.context}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const dynamicImport = new Function(
        'specifier',
        'return import(specifier)',
      ) as <T>(specifier: string) => Promise<T>;

      const { createDeepAgent } =
        await dynamicImport<DeepAgentFactory>('deepagents');
      const { createCodeInterpreterMiddleware } =
        await dynamicImport<QuickJsMiddlewareFactory>('@langchain/quickjs');

      this.logger.log(
        'Initializing Analyst Agent with QuickJS Code Interpreter...',
      );
      const agent = createDeepAgent({
        model,
        systemPrompt,
        middleware: [createCodeInterpreterMiddleware()],
      });

      const response = await agent.invoke(
        {
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        },
        { signal: input.signal },
      );

      // Extract content from DeepAgent response
      const maybeMessages = (response as { messages?: unknown }).messages;
      let content = '';
      if (Array.isArray(maybeMessages) && maybeMessages.length > 0) {
        const last = maybeMessages[maybeMessages.length - 1] as {
          content?: unknown;
        };
        if (typeof last.content === 'string') {
          content = last.content;
        } else if (Array.isArray(last.content)) {
          content = last.content
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part && typeof part === 'object' && 'text' in part) {
                const text = (part as Record<'text', unknown>).text;
                if (typeof text === 'string') return text;
              }
              return '';
            })
            .join('');
        }
      }

      if (!content) {
        content =
          typeof response === 'string' ? response : JSON.stringify(response);
      }

      this.logger.log(
        `Analyst completed in ${Date.now() - start}ms, output length=${content.length}`,
      );

      return {
        content,
        agent: this.name,
        confidence: 0.9,
        durationMs: Date.now() - start,
        promptVersion,
      };
    } catch (err) {
      if (input.signal?.aborted) throw err;
      this.logger.error(
        `Failed to run Analyst with DeepAgent/QuickJS: ${(err as Error).message}. Falling back to standard LLM invoke.`,
      );

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

        return {
          content,
          agent: this.name,
          confidence: 0.8,
          durationMs: Date.now() - start,
          promptVersion,
        };
      } catch (fallbackErr) {
        if (input.signal?.aborted) throw fallbackErr;
        this.logger.error(
          `Analyst fallback failed: ${(fallbackErr as Error).message}`,
        );
        return {
          content: `分析阶段完全失败：${(fallbackErr as Error).message}`,
          agent: this.name,
          confidence: 0,
          durationMs: Date.now() - start,
          promptVersion,
        };
      }
    }
  }
}
