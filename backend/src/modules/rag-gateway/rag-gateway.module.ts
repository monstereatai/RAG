import { Module } from '@nestjs/common';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { SkillsModule } from '../skills/skills.module';
import { RagGatewayController } from './rag-gateway.controller';
import { RagGatewayService } from './rag-gateway.service';

@Module({
  imports: [KarpathyRagModule, SkillsModule],
  controllers: [RagGatewayController],
  providers: [RagGatewayService],
})
export class RagGatewayModule {}
