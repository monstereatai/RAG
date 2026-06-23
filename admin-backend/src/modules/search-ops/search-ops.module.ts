import { Module } from '@nestjs/common';
import { SearchOpsController } from './search-ops.controller';
import { RagClientModule } from '../rag-client/rag-client.module';

@Module({
  imports: [RagClientModule],
  controllers: [SearchOpsController],
})
export class SearchOpsModule {}
