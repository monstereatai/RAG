import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SemanticExampleSelector } from './semantic-example.selector';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { BadCaseFlywheelService } from './bad-case-flywheel.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { LlmModule } from '../../providers/llm/llm.module';
import { QueryIntentRouter } from './query-intent-router';

/**
 * Prompt 工程模块
 *
 * 提供语义示例选择器等 Prompt 工程工具。
 * 对齐 agent-course/prompt-template-test/src/example-selector2.mjs 模式。
 */
@Module({
  imports: [
    ConfigModule,
    LlmModule,
    EmbeddingModule,
    TypeOrmModule.forFeature([RagFeedbackEntity, QueryLogEntity]),
  ],
  providers: [
    SemanticExampleSelector,
    BadCaseFlywheelService,
    QueryIntentRouter,
  ],
  exports: [SemanticExampleSelector, BadCaseFlywheelService, QueryIntentRouter],
})
export class PromptModule {}
