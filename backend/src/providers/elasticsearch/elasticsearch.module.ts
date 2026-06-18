import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchProvider } from './elasticsearch.provider';

/**
 * Elasticsearch Module（全局模块）
 * 文档上传/删除时调用 ElasticsearchProvider 同步索引。
 * ES 不可用时自动 disabled，不影响主流程。
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [ElasticsearchProvider],
  exports: [ElasticsearchProvider],
})
export class ElasticsearchModule {}
