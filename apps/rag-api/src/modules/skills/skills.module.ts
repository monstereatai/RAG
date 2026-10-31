import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({
  imports: [EmbeddingModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
