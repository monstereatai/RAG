import { Injectable, Logger, Optional } from '@nestjs/common';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { documentMetadataPromptDefinition } from './document-metadata.prompts';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';
import { LangfuseProvider } from '../../providers/observability/langfuse.provider';

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
  ['system', documentMetadataPromptDefinition.system],
  ['human', documentMetadataPromptDefinition.userTemplate],
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

  constructor(
    private readonly llmProvider: LlmProvider,
    @Optional() private readonly langfuseProvider?: LangfuseProvider,
  ) {}

  /**
   * 从文档内容中抽取元数据
   *
   * @param content 文档内容（截取前 2000 字以节省 token）
   * @returns 抽取的元数据，失败时返回默认值
   */
  async extract(content: string): Promise<ExtractedMetadata> {
    const startedAt = Date.now();
    const promptVersion = getPromptVersion('document.extract_metadata');
    const model = this.llmProvider.getModel();

    // 定义结构化输出的 zod schema
    const metadataSchema = z.object({
      title: z
        .string()
        .describe(documentMetadataPromptDefinition.outputSchema.title),
      author: z
        .string()
        .describe(documentMetadataPromptDefinition.outputSchema.author),
      summary: z
        .string()
        .describe(documentMetadataPromptDefinition.outputSchema.summary),
      keywords: z
        .array(z.string())
        .min(1)
        .max(8)
        .describe(documentMetadataPromptDefinition.outputSchema.keywords),
      language: z
        .string()
        .describe(documentMetadataPromptDefinition.outputSchema.language),
      category: z
        .enum(['技术文档', '教程', '报告', '笔记', '其他'])
        .describe(documentMetadataPromptDefinition.outputSchema.category),
    });

    try {
      const structured = model.withStructuredOutput(metadataSchema);
      const chain = extractMetadataPrompt.pipe(structured);

      // 截取前 2000 字以节省 token 和延迟
      const truncatedContent = content.slice(0, 2000);
      const result = await chain.invoke(
        { content: truncatedContent },
        {
          metadata: {
            promptVersion: getPromptVersion('document.extract_metadata'),
          },
        },
      );

      this.langfuseProvider?.tracePromptOperation({
        name: 'rag.document.metadata',
        promptVersions: { 'document.extract_metadata': promptVersion },
        status: 'success',
        latencyMs: Date.now() - startedAt,
        inputSummary: {
          contentChars: content.length,
          promptChars: truncatedContent.length,
        },
        outputSummary: {
          titlePresent: Boolean(result.title),
          keywordCount: result.keywords.length,
          category: result.category,
          language: result.language,
        },
      });

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
      this.langfuseProvider?.tracePromptOperation({
        name: 'rag.document.metadata',
        promptVersions: { 'document.extract_metadata': promptVersion },
        status: 'fallback',
        latencyMs: Date.now() - startedAt,
        inputSummary: { contentChars: content.length },
        outputSummary: {
          fallback: true,
          errorType: err instanceof Error ? err.name : typeof err,
        },
      });
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
