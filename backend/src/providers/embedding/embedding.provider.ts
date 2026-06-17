import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmbeddingProvider } from './embedding-provider.interface';
import { QwenEmbeddingProvider } from './qwen-embedding.provider';

/**
 * Embedding Provider 工厂
 * 按 config.embedding.provider 注入对应实现
 */
@Injectable()
export class EmbeddingProvider implements IEmbeddingProvider, OnModuleInit {
  private provider: IEmbeddingProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly qwenProvider: QwenEmbeddingProvider,
  ) {}

  onModuleInit() {
    const providerName =
      this.config.get<string>('embedding.provider') ?? 'qwen';
    switch (providerName) {
      case 'qwen':
        this.provider = this.qwenProvider;
        break;
      default:
        throw new Error(`Unsupported embedding provider: ${providerName}`);
    }
  }

  embedQuery(text: string): Promise<number[]> {
    return this.provider.embedQuery(text);
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.provider.embedDocuments(texts);
  }
}
