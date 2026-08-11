import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { IEmbeddingProvider } from './embedding-provider.interface';

/**
 * 通义千问 Embedding Provider
 * 通过 OpenAI 兼容接口调用 DashScope text-embedding-v3
 */
@Injectable()
export class QwenEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(QwenEmbeddingProvider.name);
  private readonly embeddings: OpenAIEmbeddings;
  private readonly dimension: number;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('embedding.qwen.apiKey');
    const baseUrl = this.config.get<string>('embedding.qwen.baseUrl');
    const modelName = this.config.get<string>('embedding.qwen.model');
    const dimension =
      this.config.get<number>('embedding.qwen.dimension') ?? 1024;
    this.dimension = dimension;

    if (!apiKey) {
      throw new Error('QWEN_API_KEY is required for embedding');
    }

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      model: modelName,
      configuration: { baseURL: baseUrl },
      dimensions: dimension,
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const promise = this.embeddings.embedQuery(text);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout calling embedding API')),
          3000,
        ),
      );
      return await Promise.race([promise, timeoutPromise]);
    } catch (err) {
      this.logger.warn(
        `[QwenEmbeddingProvider] embedQuery failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const batchSize = 10;
    const vectors: number[][] = [];
    try {
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const promise = this.embeddings.embedDocuments(batch);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Timeout calling embedding API')),
            5000,
          ),
        );
        vectors.push(...(await Promise.race([promise, timeoutPromise])));
      }
      return vectors;
    } catch (err) {
      this.logger.warn(
        `[QwenEmbeddingProvider] embedDocuments failed after ${vectors.length} vectors: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
