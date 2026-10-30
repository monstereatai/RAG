import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IVectorStoreProvider,
  ImageSearchHit,
  ImageVectorRecord,
  RetrievalDescriptionVectorHit,
  RetrievalDescriptionVectorRecord,
  StoredVectorRecord,
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
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<VectorSearchHit[]> {
    return this.provider.similaritySearch(
      queryVector,
      k,
      userId,
      allowedDocIds,
    );
  }

  deleteByDocId(docId: string): Promise<void> {
    return this.provider.deleteByDocId(docId);
  }

  deleteByIds(ids: string[]): Promise<void> {
    return this.provider.deleteByIds(ids);
  }

  countByDocId(docId: string, userId?: string): Promise<number> {
    return this.provider.countByDocId(docId, userId);
  }

  getVectorsByIds(ids: string[]): Promise<StoredVectorRecord[]> {
    return this.provider.getVectorsByIds(ids);
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
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<ImageSearchHit[]> {
    return this.provider.searchImages(queryVector, k, userId, allowedDocIds);
  }

  deleteImagesByDocId(docId: string, userId?: string): Promise<void> {
    return this.provider.deleteImagesByDocId(docId, userId);
  }

  countImagesByDocId(docId: string, userId?: string): Promise<number> {
    return this.provider.countImagesByDocId(docId, userId);
  }

  ensureDescriptionCollection(): Promise<void> {
    return this.provider.ensureDescriptionCollection();
  }

  upsertDescriptions(records: RetrievalDescriptionVectorRecord[]): Promise<void> {
    return this.provider.upsertDescriptions(records);
  }

  searchDescriptions(
    queryVector: number[],
    options: { tenantId: string; topK: number },
  ): Promise<RetrievalDescriptionVectorHit[]> {
    return this.provider.searchDescriptions(queryVector, options);
  }

  listDescriptionIds(tenantId: string, docId: string): Promise<string[]> {
    return this.provider.listDescriptionIds(tenantId, docId);
  }

  deleteDescriptionsByDocId(tenantId: string, docId: string): Promise<void> {
    return this.provider.deleteDescriptionsByDocId(tenantId, docId);
  }
}
