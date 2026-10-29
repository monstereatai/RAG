import { Injectable, Logger } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  ImageIndexService,
  ImageSearchItem,
} from '../modules/image-index/image-index.service';

/**
 * image_search_tool：文本搜图片资产
 *
 * 用自然语言描述检索已入库图片（DashScope 多模态嵌入把文本与图片
 * 映射到同一向量空间，Milvus rag_images 独立集合），返回 docId/url/score。
 * 依赖未配置或 Milvus 不可用时返回降级文案，不向 Agent 抛异常。
 */
@Injectable()
export class ImageSearchToolService {
  private readonly logger = new Logger(ImageSearchToolService.name);

  constructor(private readonly imageIndexService: ImageIndexService) {}

  /** 返回一个 LangChain Tool，供 Agent 调用 */
  getTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'image_search_tool',
      description:
        '文本搜图片资产：用自然语言描述在图片向量库（多模态嵌入，文本与图片同一向量空间）中检索已入库图片，返回图片 docId、URL 与相似度得分。适用于「找一张……的图」「有没有……相关的图片/示意图/架构图」等请求。',
      schema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            '图片内容的自然语言描述，例如「夕阳下的海岸线照片」「系统架构示意图」',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('返回图片数量上限，默认 5'),
        userId: z.string().optional().describe('可选的用户 ID，用于多租户隔离'),
      }),
      func: async (input: unknown) => {
        const { query, limit, userId } = input as {
          query?: string;
          limit?: number;
          userId?: string;
        };
        if (!query || !query.trim()) {
          return '未提供检索文本，无法搜索图片。';
        }
        try {
          const results = await this.imageIndexService.searchText(query, {
            topK: limit ?? 5,
            userId,
          });
          if (results.length === 0) {
            return '未找到相关图片资产。';
          }
          return `图片检索结果（${results.length} 条）:\n${results
            .map((item, index) => this.formatItem(item, index))
            .join('\n')}`;
        } catch (error) {
          this.logger.warn(
            `image_search_tool failed: ${(error as Error).message}`,
          );
          return `图片检索暂不可用：${(error as Error).message}`;
        }
      },
    });
  }

  private formatItem(item: ImageSearchItem, index: number): string {
    const metaPart = item.meta ? ` meta=${JSON.stringify(item.meta)}` : '';
    return `${index + 1}. docId=${item.docId} score=${item.score.toFixed(4)} url=${item.url}${metaPart}`;
  }
}
