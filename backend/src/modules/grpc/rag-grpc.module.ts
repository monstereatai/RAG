import { Module } from '@nestjs/common';
import { RagGrpcController } from './rag-grpc.controller';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { DocumentModule } from '../document/document.module';

@Module({
  imports: [KarpathyRagModule, DocumentModule],
  controllers: [RagGrpcController],
})
export class GrpcModule {}
