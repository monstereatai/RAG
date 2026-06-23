import { Module } from '@nestjs/common';
import { RagGrpcClientService } from './rag-grpc-client.service';

@Module({
  providers: [RagGrpcClientService],
  exports: [RagGrpcClientService],
})
export class GrpcModule {}
