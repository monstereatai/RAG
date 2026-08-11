import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { WorkflowTemplateEntity } from '../../providers/db/entities/workflow-template.entity';
import { WorkflowTemplateVersionEntity } from '../../providers/db/entities/workflow-template-version.entity';
import { PlatformPluginEntity } from '../../providers/db/entities/platform-plugin.entity';
import { ModelRegistryEntity } from '../../providers/db/entities/model-registry.entity';
import { EvaluationCaseEntity } from '../../providers/db/entities/evaluation-case.entity';
import { KnowledgeBaseProfileEntity } from '../../providers/db/entities/knowledge-base-profile.entity';
import { PlatformGovernanceController } from './platform-governance.controller';
import { PlatformGovernanceService } from './platform-governance.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkflowTemplateEntity, WorkflowTemplateVersionEntity, PlatformPluginEntity, ModelRegistryEntity, EvaluationCaseEntity, KnowledgeBaseProfileEntity]), KarpathyRagModule],
  controllers: [PlatformGovernanceController],
  providers: [PlatformGovernanceService],
  exports: [PlatformGovernanceService],
})
export class PlatformGovernanceModule {}
