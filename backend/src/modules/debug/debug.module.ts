import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';

@Module({
  imports: [KarpathyRagModule, VectorStoreModule],
  controllers: [DebugController],
})
export class DebugModule {}
