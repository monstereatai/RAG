import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationEntity, MessageEntity]),
    KarpathyRagModule,
    AgenticRagModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ConversationService],
  exports: [ConversationService],
})
export class ChatModule {}
