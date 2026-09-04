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

export interface DailyTrendItem {
  date: string;
  total: number;
  simple: number;
  agentic: number;
  auto: number;
  avgLatencyMs: number;
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

  async getDailyTrend(days = 14): Promise<DailyTrendItem[]> {
    const windowDays = Math.min(Math.max(Number(days) || 14, 1), 90);
    try {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - (windowDays - 1));

      // 窗口内数据量有限（本地量级），取回原始行在内存按天聚合，
      // 避免依赖数据库会话时区导致与前端展示日期错位。
      const rows = await this.queryLogRepo
        .createQueryBuilder('q')
        .select('q.createdAt', 'createdAt')
        .addSelect('q.mode', 'mode')
        .addSelect('q.latencyMs', 'latencyMs')
        .where('q.createdAt >= :since', { since })
        .getRawMany<{
          createdAt: Date | string;
          mode: string;
          latencyMs: number;
        }>();

      const dayKey = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`;

      const buckets = new Map<
        string,
        { total: number; simple: number; agentic: number; auto: number; latencySum: number }
      >();
      for (const row of rows) {
        const createdAt = new Date(row.createdAt);
        if (Number.isNaN(createdAt.getTime())) continue;
        const key = dayKey(createdAt);
        const bucket =
          buckets.get(key) ??
          { total: 0, simple: 0, agentic: 0, auto: 0, latencySum: 0 };
        bucket.total += 1;
        if (row.mode === 'simple') bucket.simple += 1;
        else if (row.mode === 'agentic') bucket.agentic += 1;
        else if (row.mode === 'auto') bucket.auto += 1;
        bucket.latencySum += Number(row.latencyMs) || 0;
        buckets.set(key, bucket);
      }

      const items: DailyTrendItem[] = [];
      for (let i = 0; i < windowDays; i++) {
        const day = new Date(since);
        day.setDate(since.getDate() + i);
        const key = dayKey(day);
        const bucket = buckets.get(key);
        items.push({
          date: key,
          total: bucket?.total ?? 0,
          simple: bucket?.simple ?? 0,
          agentic: bucket?.agentic ?? 0,
          auto: bucket?.auto ?? 0,
          avgLatencyMs:
            bucket && bucket.total > 0
              ? Math.round(bucket.latencySum / bucket.total)
              : 0,
        });
      }
      return items;
    } catch {
      return [];
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
