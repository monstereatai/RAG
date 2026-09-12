import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DataType,
  IndexType,
  MetricType,
  MilvusClient,
} from '@zilliz/milvus2-sdk-node';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';

export interface ApprovedBadCase {
  id: string;
  query: string;
  wrongAnswer: string;
  correctedAnswer: string;
  errorType?: string | null;
}

export type BadCaseMatchMode = 'hint' | 'correction' | 'exact';

export interface BadCaseMatch {
  id: string;
  query: string;
  text: string;
  score: number;
  mode: BadCaseMatchMode;
}

@Injectable()
export class BadCaseFlywheelService implements OnModuleInit {
  private readonly logger = new Logger(BadCaseFlywheelService.name);
  private readonly collectionName: string;
  private readonly dimension: number;
  private readonly similarityThreshold: number;
  private client: MilvusClient | null = null;
  private initialized = false;

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingProvider: EmbeddingProvider,
    @Optional()
    @InjectRepository(RagFeedbackEntity)
    private readonly feedbackRepo?: Repository<RagFeedbackEntity>,
    @Optional()
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo?: Repository<QueryLogEntity>,
  ) {
    this.collectionName =
      this.config.get<string>('vectorStore.milvus.badCaseCollection') ??
      'agent_bad_case_examples';
    this.dimension =
      this.config.get<number>('vectorStore.milvus.dimension') ?? 1024;
    this.similarityThreshold = Number(
      this.config.get<number>('agentic.badCaseSimilarityThreshold') ?? 0.85,
    );
  }

  async onModuleInit(): Promise<void> {
    const host =
      this.config.get<string>('vectorStore.milvus.host') ?? 'localhost';
    const port = this.config.get<number>('vectorStore.milvus.port') ?? 19530;
    try {
      this.client = new MilvusClient({ address: `${host}:${port}` });
      await this.client.connectPromise;
      await this.ensureCollection();
      this.initialized = true;
      this.logger.log(
        `Bad case flywheel ready, collection=${this.collectionName}`,
      );
    } catch (error) {
      this.logger.warn(
        `Bad case flywheel disabled: ${(error as Error).message}`,
      );
    }
  }

  async indexApproved(input: ApprovedBadCase) {
    if (!this.initialized || !this.client) {
      return { indexed: false, reason: 'milvus_unavailable' };
    }
    const id = `badcase_${input.id}`.slice(0, 64);
    const vector = await this.embeddingProvider.embedQuery(input.query);
    const text = [
      '【经人工审核的历史避坑提示】',
      `相似问题：${input.query}`,
      `错误类型：${input.errorType || '未分类'}`,
      `错误回答倾向：${input.wrongAnswer.slice(0, 1_000)}`,
      `正确处理标准：${input.correctedAnswer.slice(0, 3_000)}`,
    ].join('\n');
    await this.client.deleteEntities({
      collection_name: this.collectionName,
      expr: `id == "${this.escapeExpression(id)}"`,
    });
    await this.client.insert({
      collection_name: this.collectionName,
      data: [{ id, vector, query: input.query.slice(0, 2_000), text }],
    });
    await this.client.flushSync({ collection_names: [this.collectionName] });
    return { indexed: true, id };
  }

  async removeApproved(feedbackId: string) {
    if (!this.initialized || !this.client) {
      return { indexed: false, reason: 'milvus_unavailable' };
    }
    const id = `badcase_${feedbackId}`.slice(0, 64);
    await this.client.deleteEntities({
      collection_name: this.collectionName,
      expr: `id == "${this.escapeExpression(id)}"`,
    });
    await this.client.flushSync({ collection_names: [this.collectionName] });
    return { indexed: false, removed: true, id };
  }

  async selectPrompt(query: string, limit = 2): Promise<string> {
    const matches = await this.retrieveMatches(query, limit);
    if (matches.length === 0) return '';
    return this.formatPrompt(matches);
  }

  async retrieveMatches(
    query: string,
    limit = 2,
    userId?: string,
  ): Promise<BadCaseMatch[]> {
    // 纠正层与正式 RAG 同时构建候选；这里也把精确命中和语义命中并行，
    // 最终仍优先精确命中，避免把向量检索串行叠加到主问答延迟上。
    const [exactMatches, semanticMatches] = await Promise.all([
      this.findExactReviewedMatches(query, limit, userId),
      // 向量集合目前没有租户字段；带用户身份时只使用带 owner 的数据库精确层，
      // 避免把另一个租户的语义 Bad Case 泄露到当前回答。
      userId ? Promise.resolve([]) : this.findSemanticMatches(query, limit),
    ]);
    return exactMatches.length > 0 ? exactMatches : semanticMatches;
  }

  /** 只查询已审核纠正层的精确问题，用于 Karpathy 直答前的低成本覆盖检查。 */
  async retrieveExactMatches(
    query: string,
    limit = 2,
    userId?: string,
  ): Promise<BadCaseMatch[]> {
    return this.findExactReviewedMatches(query, limit, userId);
  }

  private async findSemanticMatches(
    query: string,
    limit: number,
  ): Promise<BadCaseMatch[]> {
    if (!this.initialized || !this.client) return [];
    try {
      const vector = await this.embeddingProvider.embedQuery(query);
      const result = await this.client.search({
        collection_name: this.collectionName,
        vector,
        limit: Math.min(Math.max(limit, 1), 2),
        metric_type: MetricType.COSINE,
        params: { ef: 64 },
        output_fields: ['id', 'query', 'text'],
        timeout: 1_500,
      });
      return (result.results as Array<Record<string, unknown>>)
        .map((item) => {
          const storedQuery = String(item['query'] ?? '');
          const score = this.scoreOf(item);
          return {
            id: String(item['id'] ?? item['ID'] ?? ''),
            query: storedQuery,
            text: String(item['text'] ?? ''),
            score,
            mode: this.modeOf(score, query, storedQuery),
          } satisfies BadCaseMatch;
        })
        .filter(
          (item) =>
            item.text &&
            (item.score >= this.similarityThreshold ||
              this.hasLexicalEntityMatch(query, item.query) ||
              this.isSingleChineseNameTypo(query, item.query)),
        )
        .slice(0, Math.min(Math.max(limit, 1), 2));
    } catch (error) {
      this.logger.warn(
        `Bad case selection skipped: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async findExactReviewedMatches(
    query: string,
    limit: number,
    userId?: string,
  ): Promise<BadCaseMatch[]> {
    if (!this.feedbackRepo || !this.queryLogRepo) return [];
    try {
      const queryBuilder = this.feedbackRepo
        .createQueryBuilder('feedback')
        .innerJoin(
          QueryLogEntity,
          'queryLog',
          'queryLog.id = feedback."queryLogId"',
        )
        .where('feedback.feedback = :feedback', { feedback: 'negative' })
        .andWhere('feedback.status IN (:...statuses)', {
          statuses: ['reviewed', 'resolved'],
        })
        .andWhere('feedback."knowledgeLayer" = :knowledgeLayer', {
          knowledgeLayer: 'correction',
        })
        .andWhere('feedback."correctedAnswer" IS NOT NULL');
      if (userId) {
        queryBuilder.andWhere('queryLog."userId" = :userId', { userId });
      }
      const rows = await queryBuilder
        .andWhere('LOWER(queryLog.query) = LOWER(:query)', {
          query: query.trim(),
        })
        .select([
          'feedback.id AS "feedbackId"',
          'queryLog.query AS query',
          'feedback."correctedAnswer" AS "correctedAnswer"',
        ])
        .limit(Math.min(Math.max(limit, 1), 2))
        .getRawMany<{
          feedbackId: string;
          query: string;
          correctedAnswer: string;
        }>();

      return rows.map((row) => ({
        id: `db:${row.feedbackId}`,
        query: row.query,
        text: `正确处理标准：${row.correctedAnswer}`,
        score: 1,
        mode: 'exact',
      }));
    } catch (error) {
      this.logger.warn(
        `Reviewed exact bad case lookup skipped: ${(error as Error).message}`,
      );
      return [];
    }
  }

  formatPrompt(matches: BadCaseMatch[]): string {
    return [
      '【经人工审核的相似历史 Bad Case】',
      '以下内容只用于纠正历史错误，不得覆盖当前知识库证据；若两者冲突，以当前有效证据为准。',
      ...matches.map(
        (item) =>
          `[命中级别：${item.mode}｜相似度：${item.score.toFixed(3)}]\n${item.text}`,
      ),
    ].join('\n\n');
  }

  private modeOf(
    score: number,
    query: string,
    storedQuery: string,
  ): BadCaseMatchMode {
    // 只有 PostgreSQL 精确比对或向量记录本身的同一问题才允许走“精确覆盖”。
    // 高向量分、包含关系都只是相似候选，不能绕过正式知识的版本和引用门禁。
    if (query.trim().toLowerCase() === storedQuery.trim().toLowerCase()) {
      return 'exact';
    }
    if (this.isSingleChineseNameTypo(query, storedQuery)) {
      return 'correction';
    }
    return score >= 0.88 ? 'correction' : 'hint';
  }

  private hasLexicalEntityMatch(query: string, storedQuery: string): boolean {
    const left = query.trim().toLowerCase();
    const right = storedQuery.trim().toLowerCase();
    return (
      left.length >= 2 &&
      right.length >= 2 &&
      (left.includes(right) || right.includes(left))
    );
  }

  /**
   * 受限中文姓名错字识别：同长度、同姓、仅一个中文字符不同。
   * 只用于召回已审核 Base Case，不能把不同姓氏或版本号差异自动合并。
   */
  private isSingleChineseNameTypo(query: string, storedQuery: string): boolean {
    const normalize = (value: string) =>
      value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s，。！？、,.!?]/g, '');
    const left = normalize(query);
    const right = normalize(storedQuery);
    if (
      left.length < 4 ||
      left.length > 12 ||
      left.length !== right.length ||
      left[0] !== right[0]
    ) {
      return false;
    }

    const differences = [...left].flatMap((character, index) =>
      character === [...right][index]
        ? []
        : [{ left: character, right: [...right][index] }],
    );
    return (
      differences.length === 1 &&
      /[\u3400-\u9fff]/.test(differences[0].left) &&
      /[\u3400-\u9fff]/.test(differences[0].right)
    );
  }

  private async ensureCollection(): Promise<void> {
    if (!this.client) return;
    const exists = await this.client.hasCollection({
      collection_name: this.collectionName,
    });
    if (!exists.value) {
      await this.client.createCollection({
        collection_name: this.collectionName,
        fields: [
          {
            name: 'id',
            data_type: DataType.VarChar,
            max_length: 64,
            is_primary_key: true,
          },
          {
            name: 'vector',
            data_type: DataType.FloatVector,
            dim: this.dimension,
          },
          { name: 'query', data_type: DataType.VarChar, max_length: 2048 },
          { name: 'text', data_type: DataType.VarChar, max_length: 8192 },
        ],
      });
      await this.client.createIndex({
        collection_name: this.collectionName,
        field_name: 'vector',
        index_type: IndexType.HNSW,
        metric_type: MetricType.COSINE,
        params: { M: 16, efConstruction: 200 },
      });
    }
    await this.client.loadCollection({ collection_name: this.collectionName });
  }

  private scoreOf(item: Record<string, unknown>): number {
    const value = item['score'] ?? item['distance'];
    return typeof value === 'number' ? value : 0;
  }

  private escapeExpression(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
