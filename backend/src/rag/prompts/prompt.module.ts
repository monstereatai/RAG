import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SemanticExampleSelector } from './semantic-example.selector';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';

/**
 * Prompt 工程模块
 *
 * 提供语义示例选择器等 Prompt 工程工具。
 * 对齐 agent-course/prompt-template-test/src/example-selector2.mjs 模式。
 */
@Module({
  imports: [ConfigModule, EmbeddingModule],
  providers: [SemanticExampleSelector],
  exports: [SemanticExampleSelector],
})
export class PromptModule {}
