import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentSopEntity } from '../../providers/db/entities/agent-sop.entity';
import { AgentCollaborationMessageEntity } from '../../providers/db/entities/agent-collaboration-message.entity';
import { ArtifactDependencyEntity } from '../../providers/db/entities/artifact-dependency.entity';
import { DecisionRecordEntity } from '../../providers/db/entities/decision-record.entity';
import { AgentRunEntity } from '../../providers/db/entities/agent-run.entity';
import { AgentActionEntity } from '../../providers/db/entities/agent-action.entity';
import { AgenticStructuredArtifactEntity } from '../../providers/db/entities/agentic-structured-artifact.entity';
import { AgentCollaborationService } from './agent-collaboration.service';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgentSopEntity, AgentCollaborationMessageEntity, ArtifactDependencyEntity, DecisionRecordEntity, AgentRunEntity, AgentActionEntity, AgenticStructuredArtifactEntity]), AgentRuntimeEventsModule],
  providers: [AgentCollaborationService],
  exports: [AgentCollaborationService],
})
export class AgentCollaborationModule {}
