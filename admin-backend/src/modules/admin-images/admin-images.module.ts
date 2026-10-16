import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { AdminImagesController } from './admin-images.controller';

@Module({
  imports: [RagClientModule],
  controllers: [AdminImagesController],
})
export class AdminImagesModule {}
