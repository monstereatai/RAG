import { Module } from '@nestjs/common';
import { LlmModule } from '../../providers/llm/llm.module';
import { ObservabilityModule } from '../../providers/observability/observability.module';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';
import { ChatModule } from '../chat/chat.module';
import { MemoryModule } from '../memory/memory.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { PluginRuntimeModule } from '../plugin-runtime/plugin-runtime.module';
import { AgentRunsModule } from '../agent-runs/agent-runs.module';
import { AguiController } from './agui.controller';
import { AguiService } from './agui.service';
import { TenantQuotaModule } from '../../common/tenant/tenant-quota.module';

@Module({
  imports: [
    AgenticRagModule,
    ChatModule,
    MemoryModule,
    LlmModule,
    ObservabilityModule,
    ArtifactsModule,
    PluginRuntimeModule,
    AgentRunsModule,
    TenantQuotaModule,
  ],
  controllers: [AguiController],
  providers: [AguiService],
  exports: [AguiService],
})
export class AguiModule {}
