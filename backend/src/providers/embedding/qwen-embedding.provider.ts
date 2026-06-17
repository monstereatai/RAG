import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { IEmbeddingProvider } from './embedding-provider.interface';

/**
 * 通义千问 Embedding Provider
 * 通过 OpenAI 兼容接口调用 DashScope text-embedding-v3
 */
@Injectable()
export class QwenEmbeddingProvider implements IEmbeddingProvider {
  private readonly embeddings: OpenAIEmbeddings;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('embedding.qwen.apiKey');
    const baseUrl = this.config.get<string>('embedding.qwen.baseUrl');
    const modelName = this.config.get<string>('embedding.qwen.model');
    const dimension = this.config.get<number>('embedding.qwen.dimension');

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

  embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}
