import { Module } from '@nestjs/common';
import { RagGrpcController } from './rag-grpc.controller';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { DocumentModule } from '../document/document.module';
import { AuthModule } from '../auth/auth.module';
import { IamModule } from '../iam/iam.module';

@Module({
  imports: [KarpathyRagModule, DocumentModule, AuthModule, IamModule],
  controllers: [RagGrpcController],
})
export class GrpcModule {}
