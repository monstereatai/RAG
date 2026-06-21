import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { ISubAgent, AgentInput, AgentOutput } from './agent.interface';

type DeepAgentFactory = {
  createDeepAgent: (params: {
    model: ReturnType<LlmProvider['getModel']>;
    systemPrompt: string;
    middleware?: unknown[];
  }) => {
    invoke: (input: unknown) => Promise<unknown>;
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
    const model = this.llmProvider.getModel();

    const systemPrompt = `你是一个专业的分析师。对于任何复杂的计算、排序、数据对比，你必须使用 JavaScript 代码并在沙箱执行环境（js_eval 工具）中运行它，以确保结果的绝对正确。
禁止猜测数字。你的分析报告中必须包含你的计算逻辑或运行过的 JavaScript 代码片段，以便最终结果可以被复现。
所有分析和输出必须使用中文。`;

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

      const response = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

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
      };
    } catch (err) {
      this.logger.error(
        `Failed to run Analyst with DeepAgent/QuickJS: ${(err as Error).message}. Falling back to standard LLM invoke.`,
      );

      try {
        const response = await model.invoke([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ]);

        const content =
          typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

        return {
          content,
          agent: this.name,
          confidence: 0.8,
          durationMs: Date.now() - start,
        };
      } catch (fallbackErr) {
        this.logger.error(
          `Analyst fallback failed: ${(fallbackErr as Error).message}`,
        );
        return {
          content: `分析阶段完全失败：${(fallbackErr as Error).message}`,
          agent: this.name,
          confidence: 0,
          durationMs: Date.now() - start,
        };
      }
    }
  }
}
