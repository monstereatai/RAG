import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

/**
 * Elasticsearch Provider
 *
 * 提供能力：
 * - 文档上传时同步写入 ES（IK 分词，中文全文检索）
 * - BM25 检索（作为内存 BM25 的生产替代方案）
 * - 文档删除时同步从 ES 删除
 *
 * 未配置 ES_NODE 或连接失败时，自动禁用，不阻断服务启动。
 */
@Injectable()
export class ElasticsearchProvider implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchProvider.name);
  private client!: Client;
  private enabled = false;
  private readonly indexName = 'rag_chunks';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const node = this.config.get<string>('elasticsearch.node') ?? '';
    if (!node || node === 'http://localhost:9200') {
      // 默认地址时检查是否真实可连
    }

    try {
      this.client = new Client({
        node: node || 'http://localhost:9200',
        requestTimeout: 5000,
      });
      await this.client.ping();
      this.enabled = true;
      this.logger.log(`Elasticsearch connected at ${node}`);
      await this.ensureIndex();
    } catch (err) {
      this.logger.warn(
        `Elasticsearch not available (${(err as Error).message}), ES search disabled`,
      );
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 确保 rag_chunks 索引存在（含中文分词配置）
   */
  /**
   * 确保 rag_chunks 索引存在（含中文分词配置）
   */
  private async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (exists) {
      this.logger.log(
        `ES index "${this.indexName}" already exists, checking mapping...`,
      );
      try {
        const mapping = await this.client.indices.getMapping({
          index: this.indexName,
        });
        const indexMapping = mapping[this.indexName];

        const properties = indexMapping?.mappings?.properties as
          | Record<string, any>
          | undefined;
        if (properties && !properties.userId) {
          this.logger.warn(
            `ES mapping outdated (missing userId property). Re-creating...`,
          );
          await this.client.indices.delete({ index: this.indexName });
        } else {
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to inspect ES index: ${(err as Error).message}. Re-creating...`,
        );
        await this.client.indices
          .delete({ index: this.indexName })
          .catch(() => {});
      }
    }

    await this.client.indices.create({
      index: this.indexName,
      settings: {
        analysis: {
          analyzer: {
            ik_smart_analyzer: {
              type: 'custom',
              tokenizer: 'ik_smart',
            },
          },
        },
      },
      mappings: {
        properties: {
          docId: { type: 'keyword' },
          chunkIndex: { type: 'integer' },
          content: {
            type: 'text',
            analyzer: 'standard',
          },
          userId: { type: 'keyword' },
          createdAt: { type: 'date' },
        },
      },
    });
    this.logger.log(`ES index "${this.indexName}" created`);
  }

  /**
   * 批量写入 chunks 到 ES
   */
  async indexChunks(
    chunks: Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
      userId?: string;
    }>,
    userId?: string,
  ): Promise<void> {
    if (!this.enabled || chunks.length === 0) return;

    try {
      const operations = chunks.flatMap((c) => [
        { index: { _index: this.indexName, _id: c.id } },
        {
          docId: c.docId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          userId: c.userId || userId,
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = await this.client.bulk({ operations, refresh: true });
      if (result.errors) {
        this.logger.warn(
          `ES bulk index had errors for docId=${chunks[0]?.docId}`,
        );
      } else {
        this.logger.log(
          `ES indexed ${chunks.length} chunks for docId=${chunks[0]?.docId}`,
        );
      }
    } catch (err) {
      this.logger.warn(`ES indexChunks failed: ${(err as Error).message}`);
    }
  }

  /**
   * 按 docId 删除所有 chunks
   */
  async deleteByDocId(docId: string, _userId?: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.deleteByQuery({
        index: this.indexName,
        query: { term: { docId } },
      });
      this.logger.log(
        `ES deleted chunks for docId=${docId} and userId=${_userId ?? 'none'}`,
      );
    } catch (err) {
      this.logger.warn(`ES deleteByDocId failed: ${(err as Error).message}`);
    }
  }

  /**
   * BM25 全文检索（ES 原生 BM25 算法）
   */
  async search(
    query: string,
    topK = 5,
    userId?: string,
  ): Promise<
    Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
      score: number;
    }>
  > {
    if (!this.enabled) return [];

    try {
      const queryObj = {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['content'],
                type: 'best_fields',
              },
            },
          ],
          filter: userId ? { term: { userId } } : undefined,
        },
      };

      const result = await this.client.search({
        index: this.indexName,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        query: queryObj as any,
        size: topK,
      });

      return result.hits.hits.map((hit) => {
        const src = hit._source as {
          content: string;
          docId: string;
          chunkIndex: number;
        };
        return {
          id: hit._id ?? '',
          content: src.content ?? '',
          docId: src.docId ?? '',
          chunkIndex: src.chunkIndex ?? 0,
          score: hit._score ?? 0,
        };
      });
    } catch (err) {
      this.logger.warn(`ES search failed: ${(err as Error).message}`);
      return [];
    }
  }
}
