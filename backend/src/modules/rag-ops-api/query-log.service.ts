import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';

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

@Injectable()
export class QueryLogService {
  private readonly logger = new Logger(QueryLogService.name);

  constructor(
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo: Repository<QueryLogEntity>,
  ) {}

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
