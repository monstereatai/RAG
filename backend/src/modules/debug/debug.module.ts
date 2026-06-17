import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';

@Module({
  imports: [KarpathyRagModule],
  controllers: [DebugController],
})
export class DebugModule {}
