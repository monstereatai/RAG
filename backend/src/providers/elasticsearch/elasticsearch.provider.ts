import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, estypes } from '@elastic/elasticsearch';

type IndexedChunk = {
  content: string;
  docId: string;
  chunkIndex: number;
  parentChunkId?: string | null;
  headingPath?: string[];
  sectionId?: string | null;
  clauseId?: string | null;
  tableRef?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: string;
  lifecycleStatus?: string;
  supersedesDocId?: string | null;
};

export interface ElasticsearchSearchScope {
  projectId?: string;
  activityId?: string;
  region?: string;
  locale?: string;
  channel?: string;
  role?: string;
  documentType?: string;
  includeDeprecated?: boolean;
}

const BUSINESS_PROPERTIES = {
  projectId: { type: 'keyword' },
  activityId: { type: 'keyword' },
  region: { type: 'keyword' },
  locale: { type: 'keyword' },
  channel: { type: 'keyword' },
  roleScope: { type: 'keyword' },
  documentType: { type: 'keyword' },
  lifecycleStatus: { type: 'keyword' },
  supersedesDocId: { type: 'keyword' },
} satisfies Record<string, estypes.MappingProperty>;

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
          | Record<string, unknown>
          | undefined;
        if (properties && (!properties.userId || !properties.sourceAuthority)) {
          this.logger.warn(
            `ES mapping outdated (missing userId property). Re-creating...`,
          );
          await this.client.indices.delete({ index: this.indexName });
        } else {
          if (!properties?.projectId) {
            await this.client.indices.putMapping({
              index: this.indexName,
              properties: BUSINESS_PROPERTIES,
            });
            this.logger.log('ES business metadata mapping added');
          }
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
            analyzer: 'ik_smart_analyzer',
          },
          userId: { type: 'keyword' },
          parentChunkId: { type: 'keyword' },
          headingPath: { type: 'keyword' },
          sectionId: { type: 'keyword' },
          clauseId: { type: 'keyword' },
          tableRef: { type: 'keyword' },
          sourceStart: { type: 'integer' },
          sourceEnd: { type: 'integer' },
          docVersion: { type: 'keyword' },
          effectiveAt: { type: 'date' },
          expiredAt: { type: 'date' },
          sourceAuthority: { type: 'keyword' },
          ...BUSINESS_PROPERTIES,
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
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
      effectiveAt?: Date | null;
      expiredAt?: Date | null;
      sourceAuthority?: string;
      projectId?: string | null;
      activityId?: string | null;
      region?: string | null;
      locale?: string | null;
      channel?: string | null;
      roleScope?: string[];
      documentType?: string;
      lifecycleStatus?: string;
      supersedesDocId?: string | null;
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
          parentChunkId: c.parentChunkId,
          headingPath: c.headingPath,
          sectionId: c.sectionId,
          clauseId: c.clauseId,
          tableRef: c.tableRef,
          sourceStart: c.sourceStart,
          sourceEnd: c.sourceEnd,
          docVersion: c.docVersion,
          effectiveAt: c.effectiveAt?.toISOString() ?? null,
          expiredAt: c.expiredAt?.toISOString() ?? null,
          sourceAuthority: c.sourceAuthority,
          projectId: c.projectId,
          activityId: c.activityId,
          region: c.region,
          locale: c.locale,
          channel: c.channel,
          roleScope: c.roleScope,
          documentType: c.documentType,
          lifecycleStatus: c.lifecycleStatus,
          supersedesDocId: c.supersedesDocId,
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

  async updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): Promise<void> {
    if (!this.enabled) return;
    const filter: estypes.QueryDslQueryContainer[] = [{ term: { docId } }];
    if (userId) filter.push({ term: { userId } });
    try {
      await this.client.updateByQuery({
        index: this.indexName,
        query: { bool: { filter } },
        script: {
          source: 'ctx._source.lifecycleStatus = params.status',
          params: { status: lifecycleStatus },
        },
        refresh: true,
      });
    } catch (error) {
      this.logger.warn(
        `ES lifecycle update failed for docId=${docId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * BM25 全文检索（ES 原生 BM25 算法）
   */
  async search(
    query: string,
    topK = 5,
    userId?: string,
    scope: ElasticsearchSearchScope = {},
  ): Promise<
    Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
      score: number;
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
      effectiveAt?: string | null;
      expiredAt?: string | null;
      sourceAuthority?: string;
      projectId?: string | null;
      activityId?: string | null;
      region?: string | null;
      locale?: string | null;
      channel?: string | null;
      roleScope?: string[];
      documentType?: string;
      lifecycleStatus?: string;
      supersedesDocId?: string | null;
    }>
  > {
    if (!this.enabled) return [];

    try {
      const filter: estypes.QueryDslQueryContainer[] = userId
        ? [{ term: { userId } }]
        : [];
      for (const [field, value] of Object.entries({
        projectId: scope.projectId,
        activityId: scope.activityId,
        region: scope.region,
        locale: scope.locale,
        channel: scope.channel,
        documentType: scope.documentType,
      })) {
        if (value) filter.push({ term: { [field]: value } });
      }
      if (scope.role) filter.push({ term: { roleScope: scope.role } });
      if (!scope.includeDeprecated) {
        filter.push({
          bool: {
            must_not: [{ term: { lifecycleStatus: 'deprecated' } }],
          },
        });
      }
      const queryObj: estypes.QueryDslQueryContainer = {
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
          ...(filter.length > 0 ? { filter } : {}),
        },
      };

      const result = await this.client.search<IndexedChunk>({
        index: this.indexName,
        query: queryObj,
        size: topK,
      });

      return result.hits.hits.map((hit) => {
        const src = hit._source;
        return {
          id: hit._id ?? '',
          content: src?.content ?? '',
          docId: src?.docId ?? '',
          chunkIndex: src?.chunkIndex ?? 0,
          score: hit._score ?? 0,
          parentChunkId: src?.parentChunkId,
          headingPath: src?.headingPath,
          sectionId: src?.sectionId,
          clauseId: src?.clauseId,
          tableRef: src?.tableRef,
          sourceStart: src?.sourceStart,
          sourceEnd: src?.sourceEnd,
          docVersion: src?.docVersion,
          effectiveAt: src?.effectiveAt,
          expiredAt: src?.expiredAt,
          sourceAuthority: src?.sourceAuthority,
          projectId: src?.projectId,
          activityId: src?.activityId,
          region: src?.region,
          locale: src?.locale,
          channel: src?.channel,
          roleScope: src?.roleScope,
          documentType: src?.documentType,
          lifecycleStatus: src?.lifecycleStatus,
          supersedesDocId: src?.supersedesDocId,
        };
      });
    } catch (err) {
      this.logger.warn(`ES search failed: ${(err as Error).message}`);
      return [];
    }
  }
}
