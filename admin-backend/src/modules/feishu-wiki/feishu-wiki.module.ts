import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { FeishuWikiController } from './feishu-wiki.controller';

@Module({
  imports: [RagClientModule],
  controllers: [FeishuWikiController],
})
export class FeishuWikiModule {}
