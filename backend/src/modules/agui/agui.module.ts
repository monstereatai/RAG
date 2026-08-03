import { Module } from '@nestjs/common';
import { LlmModule } from '../../providers/llm/llm.module';
import { ObservabilityModule } from '../../providers/observability/observability.module';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';
import { ChatModule } from '../chat/chat.module';
import { MemoryModule } from '../memory/memory.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { AguiController } from './agui.controller';
import { AguiService } from './agui.service';

@Module({
  imports: [
    AgenticRagModule,
    ChatModule,
    MemoryModule,
    LlmModule,
    ObservabilityModule,
    ArtifactsModule,
  ],
  controllers: [AguiController],
  providers: [AguiService],
  exports: [AguiService],
})
export class AguiModule {}
