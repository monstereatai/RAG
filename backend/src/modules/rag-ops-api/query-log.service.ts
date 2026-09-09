import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';

export interface QueryLogEntry {
  query: string;
  userId?: string;
  mode: 'simple' | 'agentic' | 'auto';
  refused: boolean;
  citationCount: number;
  latencyMs: number;
  llmTokensEstimated?: number;
  threadId?: string;
  hasAnswer: boolean;
}

export interface PopularQuery {
  query: string;
  count: number;
  avgLatencyMs: number;
}

export interface NoResultQuery {
  query: string;
  count: number;
}

export interface CostSummary {
  totalQueries: number;
  totalTokensEstimated: number;
  totalLlmCalls: number;
  byMode: Record<string, { queries: number; tokens: number }>;
}

export interface AdoptionSummary {
  windowDays: number;
  status: 'measured' | 'insufficient_real_traffic';
  activeUsers: number;
  repeatUsers: number;
  totalQueries: number;
  answeredQueries: number;
  answerRate: number;
  feedbackCount: number;
  positiveFeedbackCount: number;
  feedbackCoverage: number;
  positiveFeedbackRate: number;
}

@Injectable()
export class QueryLogService {
  private readonly logger = new Logger(QueryLogService.name);

  constructor(
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo: Repository<QueryLogEntity>,
    @InjectRepository(RagFeedbackEntity)
    private readonly feedbackRepo: Repository<RagFeedbackEntity>,
  ) {}

  async getAdoptionSummary(windowDays = 30): Promise<AdoptionSummary> {
    const days = Math.min(Math.max(Math.floor(windowDays), 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const queryStats = await this.queryLogRepo
        .createQueryBuilder('q')
        .select('COUNT(*)', 'totalQueries')
        .addSelect('COUNT(DISTINCT q.userId)', 'activeUsers')
        .addSelect(
          'SUM(CASE WHEN q.hasAnswer = true THEN 1 ELSE 0 END)',
          'answeredQueries',
        )
        .where('q.createdAt >= :since', { since })
        .getRawOne<{
          totalQueries: string;
          activeUsers: string;
          answeredQueries: string;
        }>();
      const userQueryCounts = await this.queryLogRepo
        .createQueryBuilder('q')
        .select('q.userId', 'userId')
        .addSelect('COUNT(*)', 'count')
        .where('q.createdAt >= :since AND q.userId IS NOT NULL', { since })
        .groupBy('q.userId')
        .getRawMany<{ userId: string; count: string }>();
      const feedbackStats = await this.feedbackRepo
        .createQueryBuilder('f')
        .select('COUNT(*)', 'feedbackCount')
        .addSelect(
          "SUM(CASE WHEN f.feedback = 'positive' THEN 1 ELSE 0 END)",
          'positiveFeedbackCount',
        )
        .where('f.createdAt >= :since', { since })
        .getRawOne<{ feedbackCount: string; positiveFeedbackCount: string }>();

      const totalQueries = Number(queryStats?.totalQueries ?? 0);
      const activeUsers = Number(queryStats?.activeUsers ?? 0);
      const answeredQueries = Number(queryStats?.answeredQueries ?? 0);
      const feedbackCount = Number(feedbackStats?.feedbackCount ?? 0);
      const positiveFeedbackCount = Number(
        feedbackStats?.positiveFeedbackCount ?? 0,
      );
      return {
        windowDays: days,
        status: activeUsers > 0 ? 'measured' : 'insufficient_real_traffic',
        activeUsers,
        repeatUsers: userQueryCounts.filter((item) => Number(item.count) > 1)
          .length,
        totalQueries,
        answeredQueries,
        answerRate: totalQueries ? answeredQueries / totalQueries : 0,
        feedbackCount,
        positiveFeedbackCount,
        feedbackCoverage: totalQueries ? feedbackCount / totalQueries : 0,
        positiveFeedbackRate: feedbackCount
          ? positiveFeedbackCount / feedbackCount
          : 0,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to calculate adoption summary: ${(err as Error).message}`,
      );
      return {
        windowDays: days,
        status: 'insufficient_real_traffic',
        activeUsers: 0,
        repeatUsers: 0,
        totalQueries: 0,
        answeredQueries: 0,
        answerRate: 0,
        feedbackCount: 0,
        positiveFeedbackCount: 0,
        feedbackCoverage: 0,
        positiveFeedbackRate: 0,
      };
    }
  }

  async log(entry: QueryLogEntry): Promise<void> {
    try {
      const entity = this.queryLogRepo.create({
        id: randomUUID(),
        userId: entry.userId ?? null,
        query: entry.query.slice(0, 2000),
        mode: entry.mode,
        refused: entry.refused,
        citationCount: entry.citationCount,
        latencyMs: Math.round(entry.latencyMs),
        llmTokensEstimated: entry.llmTokensEstimated ?? null,
        threadId: entry.threadId ?? null,
        hasAnswer: entry.hasAnswer,
      });
      await this.queryLogRepo.save(entity);
    } catch (err) {
      this.logger.warn(`Failed to log query: ${(err as Error).message}`);
    }
  }

  async getPopularQueries(limit = 20): Promise<PopularQuery[]> {
    try {
      const rows = await this.queryLogRepo
        .createQueryBuilder('q')
        .select('q.query', 'query')
        .addSelect('COUNT(*)', 'count')
        .addSelect('AVG(q.latencyMs)', 'avgLatencyMs')
        .groupBy('q.query')
        .orderBy('count', 'DESC')
        .limit(limit)
        .getRawMany<{ query: string; count: string; avgLatencyMs: string }>();

      return rows.map((row) => ({
        query: row.query.slice(0, 100),
        count: Number(row.count),
        avgLatencyMs: Math.round(Number(row.avgLatencyMs)),
      }));
    } catch {
      return [];
    }
  }

  async getNoResultQueries(limit = 20): Promise<NoResultQuery[]> {
    try {
      const rows = await this.queryLogRepo
        .createQueryBuilder('q')
        .select('q.query', 'query')
        .addSelect('COUNT(*)', 'count')
        .where('q.hasAnswer = :hasAnswer', { hasAnswer: false })
        .orWhere('q.refused = :refused', { refused: true })
        .groupBy('q.query')
        .orderBy('count', 'DESC')
        .limit(limit)
        .getRawMany<{ query: string; count: string }>();

      return rows.map((row) => ({
        query: row.query.slice(0, 100),
        count: Number(row.count),
      }));
    } catch {
      return [];
    }
  }

  async getRecallIssues(limit = 20) {
    try {
      const rows = await this.queryLogRepo
        .createQueryBuilder('q')
        .select('q.query', 'query')
        .addSelect('COUNT(*)', 'count')
        .addSelect('AVG(q.citationCount)', 'avgCitations')
        .where('q.citationCount = 0 AND q.hasAnswer = true')
        .groupBy('q.query')
        .orderBy('count', 'DESC')
        .limit(limit)
        .getRawMany<{ query: string; count: string; avgCitations: string }>();

      return rows.map((row) => ({
        query: row.query.slice(0, 100),
        count: Number(row.count),
        avgCitations: Number(row.avgCitations),
      }));
    } catch {
      return [];
    }
  }

  async getCostSummary(): Promise<CostSummary> {
    try {
      const stats = await this.queryLogRepo
        .createQueryBuilder('q')
        .select('q.mode', 'mode')
        .addSelect('COUNT(*)', 'queries')
        .addSelect('COALESCE(SUM(q.llmTokensEstimated), 0)', 'tokens')
        .groupBy('q.mode')
        .getRawMany<{ mode: string; queries: string; tokens: string }>();

      const byMode: Record<string, { queries: number; tokens: number }> = {};
      let totalQueries = 0;
      let totalTokens = 0;

      for (const row of stats) {
        const queries = Number(row.queries);
        const tokens = Number(row.tokens);
        byMode[row.mode] = { queries, tokens };
        totalQueries += queries;
        totalTokens += tokens;
      }

      return {
        totalQueries,
        totalTokensEstimated: totalTokens,
        totalLlmCalls: totalQueries,
        byMode,
      };
    } catch {
      return {
        totalQueries: 0,
        totalTokensEstimated: 0,
        totalLlmCalls: 0,
        byMode: {},
      };
    }
  }
}
