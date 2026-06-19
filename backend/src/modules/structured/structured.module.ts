import { Module } from '@nestjs/common';
import { StructuredController } from './structured.controller';
import { StructuredService } from './structured.service';
import { LlmModule } from '../../providers/llm/llm.module';

import { GraphExtractorService } from './graph-extractor.service';

@Module({
  imports: [LlmModule],
  controllers: [StructuredController],
  providers: [StructuredService, GraphExtractorService],
  exports: [StructuredService, GraphExtractorService],
})
export class StructuredModule {}
