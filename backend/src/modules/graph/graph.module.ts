import { Module } from '@nestjs/common';
import { GraphController } from './graph.controller';
import { GraphService } from './graph.service';
import { StructuredModule } from '../structured/structured.module';
import { LlmModule } from '../../providers/llm/llm.module';
import { Neo4jModule } from '../../providers/neo4j/neo4j.module';

@Module({
  imports: [StructuredModule, LlmModule, Neo4jModule],
  controllers: [GraphController],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
