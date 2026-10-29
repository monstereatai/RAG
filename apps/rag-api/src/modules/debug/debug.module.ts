import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { RagModule } from '../../rag/rag.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';

@Module({
  imports: [RagModule, VectorStoreModule],
  controllers: [DebugController],
})
export class DebugModule {}
