import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';

@Module({
  imports: [KarpathyRagModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
