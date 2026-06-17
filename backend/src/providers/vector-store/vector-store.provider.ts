import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IVectorStoreProvider,
  VectorRecord,
  VectorSearchHit,
} from './vector-store-provider.interface';
import { MilvusVectorStoreProvider } from './milvus.vector-store';

/**
 * VectorStore Provider 工厂
 * 按 config.vectorStore.provider 注入对应实现
 */
@Injectable()
export class VectorStoreProvider implements IVectorStoreProvider, OnModuleInit {
  private provider: IVectorStoreProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly milvusProvider: MilvusVectorStoreProvider,
  ) {}

  onModuleInit() {
    const providerName =
      this.config.get<string>('vectorStore.provider') ?? 'milvus';
    switch (providerName) {
      case 'milvus':
        this.provider = this.milvusProvider;
        break;
      default:
        throw new Error(`Unsupported vector store provider: ${providerName}`);
    }
  }

  ensureCollection(): Promise<void> {
    return this.provider.ensureCollection();
  }

  insert(records: VectorRecord[]): Promise<void> {
    return this.provider.insert(records);
  }

  similaritySearch(
    queryVector: number[],
    k: number,
  ): Promise<VectorSearchHit[]> {
    return this.provider.similaritySearch(queryVector, k);
  }

  deleteByDocId(docId: string): Promise<void> {
    return this.provider.deleteByDocId(docId);
  }
}
