import { Logger } from '@nestjs/common';
import { Client, estypes } from '@elastic/elasticsearch';
import type {
  ElasticsearchSearchScope,
  IndexedDocument,
} from './elasticsearch.provider.types';

const ES_DOCUMENT_WRITE_TIMEOUT_MS = 120_000;

export abstract class ElasticsearchDocumentSupport {
  protected abstract readonly logger: Logger;
  protected abstract client: Client;
  protected abstract enabled: boolean;
  protected abstract readonly documentIndexName: string;

  protected async ensureDocumentIndex(): Promise<void> {
    const exists = await this.client.indices.exists({
      index: this.documentIndexName,
    });
    if (exists) {
      // 幂等补字段：为存量 kh_document 索引补齐 updatedAt（更新时间筛选依赖此字段）
      // ES 支持给现有索引新增字段；失败仅告警，不阻塞启动，也绝不删除存量索引
      try {
        const mapping = await this.client.indices.getMapping({
          index: this.documentIndexName,
        });
        const properties = mapping[this.documentIndexName]?.mappings
          ?.properties as Record<string, unknown> | undefined;
        if (properties && !properties.updatedAt) {
          try {
            await this.client.indices.putMapping({
              index: this.documentIndexName,
              properties: { updatedAt: { type: 'date' } },
            });
            this.logger.log(
              `ES mapping patched for "${this.documentIndexName}": added updatedAt`,
            );
          } catch (patchErr) {
            this.logger.warn(
              `ES putMapping (updatedAt) for "${this.documentIndexName}" failed, updatedRange filter unavailable until patched, startup continues: ${(patchErr as Error).message}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to inspect ES index "${this.documentIndexName}": ${(err as Error).message}`,
        );
      }
      return;
    }

    await this.client.indices.create({
      index: this.documentIndexName,
      settings: {
        analysis: {
          analyzer: {
            ik_smart_analyzer: { type: 'custom', tokenizer: 'ik_smart' },
          },
        },
      },
      mappings: {
        properties: {
          docId: { type: 'keyword' },
          filename: {
            type: 'text',
            analyzer: 'ik_smart_analyzer',
            fields: { keyword: { type: 'keyword' } },
          },
          title: { type: 'text', analyzer: 'ik_smart_analyzer' },
          summary: { type: 'text', analyzer: 'ik_smart_analyzer' },
          content: { type: 'text', analyzer: 'ik_smart_analyzer' },
          userId: { type: 'keyword' },
          sourceAuthority: { type: 'keyword' },
          projectId: { type: 'keyword' },
          activityId: { type: 'keyword' },
          region: { type: 'keyword' },
          locale: { type: 'keyword' },
          channel: { type: 'keyword' },
          roleScope: { type: 'keyword' },
          documentType: { type: 'keyword' },
          lifecycleStatus: { type: 'keyword' },
          docVersion: { type: 'keyword' },
          contentHash: { type: 'keyword' },
          indexGeneration: { type: 'keyword' },
          ruleKey: { type: 'keyword' },
          changeType: { type: 'keyword' },
          supersedesChunkId: { type: 'keyword' },
          tenantId: { type: 'keyword' },
          effectiveAt: { type: 'date' },
          expiredAt: { type: 'date' },
          updatedAt: { type: 'date' },
        },
      },
    });
    this.logger.log(`ES document index "${this.documentIndexName}" created`);
  }

  async indexDocument(document: {
    docId: string;
    filename: string;
    content: string;
    userId?: string | null;
    tenantId?: string | null;
    title?: string | null;
    summary?: string | null;
    sourceAuthority?: string;
    projectId?: string | null;
    activityId?: string | null;
    region?: string | null;
    locale?: string | null;
    channel?: string | null;
    roleScope?: string[];
    documentType?: string;
    lifecycleStatus?: string;
    docVersion?: string | null;
    contentHash?: string | null;
    indexGeneration?: string | null;
    changeType?: string;
    effectiveAt?: Date | null;
    expiredAt?: Date | null;
  }): Promise<void> {
    if (!this.enabled || !document.content.trim()) return;
    try {
      await this.client.index(
        {
          index: this.documentIndexName,
          id: document.docId,
          refresh: true,
          document: {
            ...document,
            effectiveAt: document.effectiveAt?.toISOString() ?? null,
            expiredAt: document.expiredAt?.toISOString() ?? null,
            // 每次写入都刷新 updatedAt，供搜索的更新时间筛选使用
            updatedAt: new Date().toISOString(),
          },
        },
        { requestTimeout: ES_DOCUMENT_WRITE_TIMEOUT_MS },
      );
    } catch (err) {
      this.logger.warn(`ES indexDocument failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async searchDocuments(
    query: string,
    topK = 20,
    userId?: string,
    scope: ElasticsearchSearchScope = {},
  ): Promise<
    Array<{
      docId: string;
      filename: string;
      title?: string | null;
      summary?: string | null;
      score: number;
      highlightFragments: string[];
      docVersion?: string | null;
      lifecycleStatus?: string;
      sourceAuthority?: string;
    }>
  > {
    if (!this.enabled || !query.trim()) return [];
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
      // 高级筛选：文件类型（filename.keyword 后缀匹配）与更新时间（updatedAt date math range）
      if (scope.fileType) {
        filter.push({
          wildcard: { 'filename.keyword': `*.${scope.fileType}` },
        });
      }
      if (scope.updatedRange) {
        const gte = {
          day: 'now-1d/d',
          week: 'now-7d/d',
          month: 'now-30d/d',
        }[scope.updatedRange];
        if (gte) filter.push({ range: { updatedAt: { gte } } });
      }
      if (!scope.includeDeprecated) {
        filter.push({
          bool: { must_not: [{ term: { lifecycleStatus: 'deprecated' } }] },
        });
      }
      // 审批/归档门禁：draft 未经审批、archived 已归档，任何检索口径都不可见
      filter.push({
        bool: {
          must_not: [
            { term: { lifecycleStatus: 'draft' } },
            { term: { lifecycleStatus: 'archived' } },
          ],
        },
      });
      const result = await this.client.search<IndexedDocument>({
        index: this.documentIndexName,
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query,
                  fields: ['title^3', 'filename^2', 'summary', 'content'],
                  type: 'best_fields',
                },
              },
            ],
            ...(filter.length ? { filter } : {}),
          },
        },
        size: Math.min(Math.max(topK, 1), 50),
        highlight: {
          fields: {
            content: { fragment_size: 220, number_of_fragments: 3 },
            title: { number_of_fragments: 1 },
            summary: { fragment_size: 180, number_of_fragments: 1 },
          },
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
        },
      });
      return result.hits.hits.map((hit) => {
        const source = hit._source;
        const highlights = [
          ...(hit.highlight?.title ?? []),
          ...(hit.highlight?.summary ?? []),
          ...(hit.highlight?.content ?? []),
        ].map(String);
        return {
          docId: source?.docId ?? hit._id ?? '',
          filename: source?.filename ?? '',
          title: source?.title ?? null,
          summary: source?.summary ?? null,
          score: hit._score ?? 0,
          highlightFragments: highlights,
          docVersion: source?.docVersion,
          lifecycleStatus: source?.lifecycleStatus,
          sourceAuthority: source?.sourceAuthority,
        };
      });
    } catch (err) {
      this.logger.warn(`ES document search failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getDocumentSearchFacets(): Promise<{
    documentTypes: string[];
    roles: string[];
  }> {
    const empty: { documentTypes: string[]; roles: string[] } = {
      documentTypes: [],
      roles: [],
    };
    if (!this.enabled) return empty;
    try {
      const result = await this.client.search<IndexedDocument>({
        index: this.documentIndexName,
        size: 0,
        query: {
          bool: {
            must_not: [
              { term: { lifecycleStatus: 'draft' } },
              { term: { lifecycleStatus: 'deprecated' } },
            ],
          },
        },
        aggs: {
          documentTypes: { terms: { field: 'documentType', size: 20 } },
          roles: { terms: { field: 'roleScope', size: 20 } },
        },
      });
      const toKeys = (aggregate: unknown): string[] => {
        const buckets =
          (aggregate as { buckets?: Array<{ key: unknown }> } | undefined)
            ?.buckets ?? [];
        return buckets.map((bucket) => String(bucket.key));
      };
      const aggs = result.aggregations as
        | { documentTypes?: unknown; roles?: unknown }
        | undefined;
      return {
        documentTypes: toKeys(aggs?.documentTypes),
        roles: toKeys(aggs?.roles),
      };
    } catch (err) {
      this.logger.warn(`ES document facets failed: ${(err as Error).message}`);
      return empty;
    }
  }
}
