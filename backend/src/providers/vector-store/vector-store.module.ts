import { Module } from '@nestjs/common';
import { VectorStoreProvider } from './vector-store.provider';
import { MilvusVectorStoreProvider } from './milvus.vector-store';

@Module({
  providers: [VectorStoreProvider, MilvusVectorStoreProvider],
  exports: [VectorStoreProvider],
})
export class VectorStoreModule {}
