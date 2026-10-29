import { Module } from '@nestjs/common';
import { RagGrpcController } from './rag-grpc.controller';
import { RagModule } from '../../rag/rag.module';
import { DocumentModule } from '../document/document.module';
import { AuthModule } from '../auth/auth.module';
import { IamModule } from '../iam/iam.module';

@Module({
  imports: [RagModule, DocumentModule, AuthModule, IamModule],
  controllers: [RagGrpcController],
})
export class GrpcModule {}
