import { Module } from '@nestjs/common';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';
import { ChatModule } from '../chat/chat.module';
import { MemoryModule } from '../memory/memory.module';
import { AguiController } from './agui.controller';
import { AguiService } from './agui.service';

@Module({
  imports: [AgenticRagModule, ChatModule, MemoryModule],
  controllers: [AguiController],
  providers: [AguiService],
})
export class AguiModule {}
