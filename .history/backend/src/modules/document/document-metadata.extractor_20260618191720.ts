import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { LlmProvider } from '../../providers/llm/llm.provider';

/**
 * 文档元数据抽取结果
 */
export interface ExtractedMetadata {
  title: string;
  author: string;
  summary: string;
  keywords: string[];
  language: string;
  category: string;
}

/**
 * 文档元数据抽取 Prompt
 */
const extractMetadataPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个文档分析助手。请从给定的文档内容中抽取以下元数据：
- title：文档标题（如果有明确标题则提取，否则根据内容生成一个简洁标题）
- author：作者（如果文档中提及，否则填"未知"）
- summary：内容摘要（100字以内，概括文档核心内容）
- keywords：关键词列表（3-8个，提取最重要的术语/概念）
- language：语言（如"中文"、"英文"）
- category：文档类别（如"技术文档"、"教程"、"报告"、"笔记"、"其他"）

只输出结构化字段，不要额外解释。`,
  ],
  ['human', '{content}'],
]);

/**
 * 文档元数据抽取服务
 *
 * 使用 LLM + zod structured output 从文档内容中自动抽取元数据。
 * 对齐 agent-course/output-parser-test/src/with-structured-output.mjs 模式。
 */
@Injectable()
export class DocumentMetadataExtractor {
  private readonly logger = new Logger(DocumentMetadataExtractor.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  /**
   * 从文档内容中抽取元数据
   *
   * @param content 文档内容（截取前 2000 字以节省 token）
   * @returns 抽取的元数据，失败时返回默认值
   */
  async extract(content: string): Promise<ExtractedMetadata> {
    const model = this.llmProvider.getModel();

    // 定义结构化输出的 zod schema
    const metadataSchema = z.object({
      title: z.string().describe('文档标题'),
      author: z.string().describe('作者（未知则填"未知"）'),
      summary: z.string().describe('内容摘要（100字以内）'),
      keywords: z
        .array(z.string())
        .min(1)
        .max(8)
        .describe('关键词列表（3-8个）'),
      language: z.string().describe('文档语言（如"中文"、"英文"）'),
      category: z
        .enum(['技术文档', '教程', '报告', '笔记', '其他'])
        .describe('文档类别'),
    });

    try {
      const structured = model.withStructuredOutput(metadataSchema);
      const chain = extractMetadataPrompt.pipe(structured);

      // 截取前 2000 字以节省 token 和延迟
      const truncatedContent = content.slice(0, 2000);
      const result = await chain.invoke({ content: truncatedContent });

      this.logger.log(
        `Metadata extracted: title="${result.title}", category=${result.category}, keywords=${result.keywords.length}`,
      );

      return {
        title: result.title,
        author: result.author,
        summary: result.summary,
        keywords: result.keywords,
        language: result.language,
        category: result.category,
      };
    } catch (err) {
      this.logger.warn(
        `Metadata extraction failed: ${(err as Error).message}. Using defaults.`,
      );

      // 返回默认值，不阻断上传流程
      return {
        title: '',
        author: '未知',
        summary: '',
        keywords: [],
        language: '未知',
        category: '其他',
      };
    }
  }

  /**
   * 批量抽取文档元数据
   *
   * @param documents 文档列表（filename + content）
   * @returns 元数据列表
   */
  async extractBatch(
    documents: Array<{ filename: string; content: string }>,
  ): Promise<ExtractedMetadata[]> {
    const results: ExtractedMetadata[] = [];
    for (const doc of documents) {
      const metadata = await this.extract(doc.content);
      results.push(metadata);
    }
    return results;
  }
}
