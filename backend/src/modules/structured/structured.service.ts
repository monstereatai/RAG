import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { IterableReadableStream } from '@langchain/core/utils/stream';

@Injectable()
export class StructuredService {
  private readonly logger = new Logger(StructuredService.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  /**
   * 生成流式结构化报告
   */
  async streamReport(topic: string, onEvent: (data: string) => void) {
    const model = this.llmProvider.getModel();
    
    // 定义一个结构化输出的 Schema (例如研究报告)
    const reportSchema = z.object({
      title: z.string().describe('报告的标题'),
      summary: z.string().describe('报告摘要，100字左右'),
      keyPoints: z.array(z.string()).describe('报告的几个核心要点'),
      conclusion: z.string().describe('总结结论'),
    });

    try {
      // 使用 .withStructuredOutput 支持结构化输出
      // 注意：流式返回结构化输出时，LangChain 可能会发出 Partial 的 JSON 对象
      const structuredLlm = model.withStructuredOutput(reportSchema);

      const stream = await structuredLlm.stream(
        `请为我生成一份关于 "${topic}" 的结构化分析报告。`,
      );

      for await (const chunk of stream) {
        // chunk 在 stream 模式下通常是一个 partial parsed object
        // 我们可以将其序列化为 JSON 字符串推送到前端
        onEvent(JSON.stringify(chunk));
      }
    } catch (err) {
      this.logger.error(`Error in streamReport: ${(err as Error).message}`);
      throw err;
    }
  }
}
