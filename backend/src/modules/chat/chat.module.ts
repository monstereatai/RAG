import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ConversationEmbeddingService } from './conversation-embedding.service';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';
import { MemoryModule } from '../memory/memory.module';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { RagFeedbackService } from './rag-feedback.service';
import { PromptModule } from '../../rag/prompts/prompt.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      QueryLogEntity,
      RagFeedbackEntity,
    ]),
    ConfigModule,
    KarpathyRagModule,
    AgenticRagModule,
    MemoryModule,
    EmbeddingModule,
    PromptModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ConversationService,
    ConversationEmbeddingService,
    RagFeedbackService,
  ],
  exports: [
    ConversationService,
    ConversationEmbeddingService,
    RagFeedbackService,
  ],
})
export class ChatModule {}
