import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IVectorStoreProvider,
  ImageSearchHit,
  ImageVectorRecord,
  VectorIndexInfo,
  VectorRecord,
  VectorSearchHit,
  VectorStoreRuntimeStatus,
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
    userId?: string,
  ): Promise<VectorSearchHit[]> {
    return this.provider.similaritySearch(queryVector, k, userId);
  }

  deleteByDocId(docId: string): Promise<void> {
    return this.provider.deleteByDocId(docId);
  }

  getIndexInfo(): VectorIndexInfo {
    return this.provider.getIndexInfo();
  }

  getRuntimeStatus(): VectorStoreRuntimeStatus {
    return this.provider.getRuntimeStatus();
  }

  ensureImageCollection(): Promise<void> {
    return this.provider.ensureImageCollection();
  }

  insertImages(records: ImageVectorRecord[]): Promise<void> {
    return this.provider.insertImages(records);
  }

  searchImages(
    queryVector: number[],
    k: number,
    userId?: string,
  ): Promise<ImageSearchHit[]> {
    return this.provider.searchImages(queryVector, k, userId);
  }

  deleteImagesByDocId(docId: string, userId?: string): Promise<void> {
    return this.provider.deleteImagesByDocId(docId, userId);
  }
}
