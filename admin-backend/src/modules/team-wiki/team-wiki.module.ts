import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { TeamWikiController } from './team-wiki.controller';

@Module({
  imports: [RagClientModule],
  controllers: [TeamWikiController],
})
export class TeamWikiModule {}
