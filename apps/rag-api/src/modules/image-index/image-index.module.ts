import { Module } from '@nestjs/common';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { MultimodalEmbeddingModule } from '../../providers/multimodal-embedding/multimodal-embedding.module';
import {
  IMAGE_VECTOR_STORE_PORT,
  ImageIndexService,
} from './image-index.service';

/**
 * 图片索引/检索模块（以图搜图 / 文搜图）
 *
 * - 导出 ImageIndexService：DocumentModule / ToolsModule / RagAdminModule 注入使用
 * - 图片向量落 Milvus rag_images 独立集合（绑定 VectorStoreProvider 端口）
 */
@Module({
  imports: [VectorStoreModule, MultimodalEmbeddingModule],
  providers: [
    ImageIndexService,
    // 端口绑定：生产用 Milvus VectorStoreProvider，测试可整体替换
    { provide: IMAGE_VECTOR_STORE_PORT, useExisting: VectorStoreProvider },
  ],
  exports: [ImageIndexService],
})
export class ImageIndexModule {}
