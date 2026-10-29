import { Module } from '@nestjs/common';
import { LlmModule } from '../../providers/llm/llm.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { GroundedAnswerGenerationService } from './grounded-answer-generation.service';

@Module({
  imports: [LlmModule, EvidenceModule],
  providers: [GroundedAnswerGenerationService],
  exports: [GroundedAnswerGenerationService],
})
export class GenerationModule {}
