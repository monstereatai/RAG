import { Module } from '@nestjs/common';
import { AgentRuntimeController } from './agent-runtime.controller';
import { AgentRuntimeService } from './agent-runtime.service';
import { SkillsModule } from '../skills/skills.module';

@Module({ imports: [SkillsModule], controllers: [AgentRuntimeController], providers: [AgentRuntimeService], exports: [AgentRuntimeService] })
export class AgentRuntimeModule {}
