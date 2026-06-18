import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';

@Module({
  imports: [KarpathyRagModule, AgenticRagModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
