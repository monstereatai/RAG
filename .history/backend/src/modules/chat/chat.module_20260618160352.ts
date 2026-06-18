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

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationEntity, MessageEntity]),
    ConfigModule,
    KarpathyRagModule,
    AgenticRagModule,
    MemoryModule,
    EmbeddingModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ConversationService, ConversationEmbeddingService],
  exports: [ConversationService, ConversationEmbeddingService],
})
export class ChatModule {}
