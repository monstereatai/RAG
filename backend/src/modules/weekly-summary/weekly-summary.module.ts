import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeeklySummaryEntity } from '../../providers/db/entities/weekly-summary.entity';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { LlmModule } from '../../providers/llm/llm.module';
import { WeeklySummaryService } from './weekly-summary.service';
import { WeeklySummaryController } from './weekly-summary.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([WeeklySummaryEntity, ConversationEntity, MessageEntity]),
    LlmModule,
  ],
  controllers: [WeeklySummaryController],
  providers: [WeeklySummaryService],
  exports: [WeeklySummaryService],
})
export class WeeklySummaryModule {}
