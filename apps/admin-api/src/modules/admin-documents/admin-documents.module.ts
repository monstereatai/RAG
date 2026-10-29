import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { AdminDocumentsController } from './admin-documents.controller';

@Module({
  imports: [RagClientModule],
  controllers: [AdminDocumentsController],
})
export class AdminDocumentsModule {}
