import type { RagAdminServiceContext } from './rag-admin.service.context';

import type { CapabilitiesResponse } from './rag-admin.service.types';

export class RagAdminOverviewWorkflow {
  constructor(private readonly context: RagAdminServiceContext) {}

  getCapabilities(): CapabilitiesResponse {
    const vsProvider =
      this.context.configService.get<string>('vectorStore.provider') ??
      'milvus';
    const rerankProvider =
      this.context.configService.get<string>('RERANK_PROVIDER') ?? 'dashscope';
    const embeddingProvider =
      this.context.configService.get<string>('EMBEDDING_PROVIDER') ?? 'qwen';

    return {
      vectorStore: {
        provider: vsProvider,
        available:
          this.context.vectorStoreProvider.getRuntimeStatus().available,
      },
      bm25: {
        available: true,
        engine: this.context.elasticsearchProvider.isEnabled()
          ? 'elasticsearch'
          : 'memory',
      },
      elasticsearch: {
        available: this.context.elasticsearchProvider.isEnabled(),
      },
      rerank: {
        available: !!this.context.configService.get<string>('RERANK_API_KEY'),
        provider: rerankProvider,
      },
      graphRag: {
        available: this.context.graphService.isEnabled(),
      },
      mcp: {
        available:
          this.context.configService.get<string>('MCP_ENABLED') === 'true',
      },
      mem0: {
        available: !!this.context.configService.get<string>('MEM0_API_KEY'),
      },
      redis: {
        available: !!this.context.configService.get<string>('redis.url'),
      },
      speech: {
        available:
          !!this.context.configService.get<string>('TENCENT_SECRET_ID') &&
          !!this.context.configService.get<string>('TENCENT_SECRET_KEY'),
      },
      agui: {
        available: true,
        endpoint: '/api/v1/agui/stream',
      },
      langSmith: {
        available:
          this.context.configService.get<boolean>('langsmith.tracing') ===
            true &&
          !!this.context.configService.get<string>('langsmith.apiKey'),
        tracing:
          this.context.configService.get<boolean>('langsmith.tracing') === true,
        project:
          this.context.configService.get<string>('langsmith.project') ??
          'rag-evaluation',
      },
      evaluation: {
        available: true,
        scripts: [
          'eval:rag',
          'eval:rag:e2e',
          'eval:rag:judge',
          'eval:rag:langsmith',
          'eval:rag:quality',
        ],
      },
      webSearch: {
        available: !!this.context.configService.get<string>('BOCHA_API_KEY'),
      },
      embedding: {
        provider: embeddingProvider,
        available: true,
      },
    };
  }

  getIndexCompensationStatus() {
    return this.context.documentService.getIndexCompensationStatus();
  }

  getDocumentQueueStatus() {
    return this.context.documentQueue.getStatus();
  }

  async getDocumentStats() {
    const allDocs = await this.context.docMetaRepo.find({
      order: { createdAt: 'DESC', docId: 'DESC' },
    });

    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;

    const tally = (values: string[]) => {
      const counts = new Map<string, number>();
      for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };

    // 近 14 日上传趋势（含空日补零）
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 13);
    const uploadsByDay = new Map<string, number>();
    for (const doc of allDocs) {
      const createdAt = new Date(doc.createdAt);
      if (Number.isNaN(createdAt.getTime()) || createdAt < since) continue;
      const key = dayKey(createdAt);
      uploadsByDay.set(key, (uploadsByDay.get(key) ?? 0) + 1);
    }
    const uploadsTrend: { date: string; count: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      const key = dayKey(day);
      uploadsTrend.push({ date: key, count: uploadsByDay.get(key) ?? 0 });
    }

    const byFileType = tally(
      allDocs.map((doc) => {
        const dot = doc.filename.lastIndexOf('.');
        return dot >= 0 ? doc.filename.slice(dot + 1).toLowerCase() : 'other';
      }),
    );

    return {
      available: true,
      data: {
        total: allDocs.length,
        totalChunks: allDocs.reduce(
          (sum, doc) => sum + (doc.chunkCount ?? 0),
          0,
        ),
        categoryCount: new Set(allDocs.map((doc) => doc.category ?? '其他'))
          .size,
        last7DaysNew: uploadsTrend
          .slice(-7)
          .reduce((sum, item) => sum + item.count, 0),
        byCategory: tally(allDocs.map((doc) => doc.category ?? '其他')),
        byLifecycleStatus: tally(
          allDocs.map((doc) => doc.lifecycleStatus ?? 'unknown'),
        ),
        byReviewStatus: tally(
          allDocs.map((doc) => doc.reviewStatus ?? 'unknown'),
        ),
        byFileType,
        uploadsTrend,
        latest: allDocs.slice(0, 5).map((doc) => ({
          docId: doc.docId,
          filename: doc.filename,
          category: doc.category ?? '其他',
          chunkCount: doc.chunkCount,
          createdAt: doc.createdAt.toISOString(),
        })),
      },
    };
  }

  async getQualitySummary(limit = 500) {
    const logs = this.context.queryLogRepo
      ? await this.context.queryLogRepo.find({
          order: { createdAt: 'DESC' },
          take: Math.min(Math.max(limit, 1), 2000),
        })
      : [];
    const answered = logs.filter((log) => log.hasAnswer).length;
    const cited = logs.filter((log) => log.citationCount > 0).length;
    const refused = logs.filter((log) => log.refused).length;
    const latency = logs.length
      ? logs.reduce((sum, log) => sum + log.latencyMs, 0) / logs.length
      : 0;
    const trend = Array.from({ length: 14 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (13 - index));
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const dayLogs = logs.filter(
        (log) => log.createdAt >= day && log.createdAt < next,
      );
      return {
        date: day.toISOString().slice(0, 10),
        requests: dayLogs.length,
        answerRate: dayLogs.length
          ? dayLogs.filter((log) => log.hasAnswer).length / dayLogs.length
          : 0,
        citationRate: dayLogs.length
          ? dayLogs.filter((log) => log.citationCount > 0).length /
            dayLogs.length
          : 0,
        averageLatencyMs: dayLogs.length
          ? Math.round(
              dayLogs.reduce((sum, log) => sum + log.latencyMs, 0) /
                dayLogs.length,
            )
          : 0,
      };
    });
    const thresholds = {
      minAnswerRate: 0.8,
      minCitationRate: 0.7,
      maxRefusalRate: 0.2,
    };
    return {
      available: true,
      scanned: logs.length,
      answerRate: logs.length ? answered / logs.length : 0,
      citationRate: logs.length ? cited / logs.length : 0,
      refusalRate: logs.length ? refused / logs.length : 0,
      averageLatencyMs: Math.round(latency),
      byMode: ['simple', 'agentic', 'auto'].map((mode) => {
        const modeLogs = logs.filter((log) => log.mode === mode);
        return {
          mode,
          count: modeLogs.length,
          answerRate: modeLogs.length
            ? modeLogs.filter((log) => log.hasAnswer).length / modeLogs.length
            : 0,
        };
      }),
      trend,
      gate: {
        passed:
          (logs.length ? answered / logs.length : 0) >=
            thresholds.minAnswerRate &&
          (logs.length ? cited / logs.length : 0) >=
            thresholds.minCitationRate &&
          (logs.length ? refused / logs.length : 0) <=
            thresholds.maxRefusalRate,
        thresholds,
        reasons: [
          ...(answered / Math.max(logs.length, 1) < thresholds.minAnswerRate
            ? ['回答率低于门槛']
            : []),
          ...(cited / Math.max(logs.length, 1) < thresholds.minCitationRate
            ? ['引用率低于门槛']
            : []),
          ...(refused / Math.max(logs.length, 1) > thresholds.maxRefusalRate
            ? ['拒答率高于门槛']
            : []),
        ],
      },
    };
  }

  async getIntentRoutingSummary(limit = 200) {
    const logs = this.context.queryLogRepo
      ? await this.context.queryLogRepo.find({
          order: { createdAt: 'DESC' },
          take: Math.min(Math.max(limit, 1), 1000),
        })
      : [];
    const recent = logs.slice(0, 50).map((log) => {
      const hasRetrievalEvidence = log.citationCount > 0;
      return {
        id: log.id,
        query: log.query.slice(0, 160),
        action: hasRetrievalEvidence ? 'retrieve' : 'unknown',
        queryType: hasRetrievalEvidence ? 'evidence_backed' : 'not_recorded',
        confidence: hasRetrievalEvidence ? 1 : null,
        createdAt: log.createdAt.toISOString(),
        mode: log.mode,
        answered: log.hasAnswer,
        cited: log.citationCount > 0,
      };
    });
    const retrieveCount = recent.filter(
      (item) => item.action === 'retrieve',
    ).length;
    const unknownCount = recent.length - retrieveCount;
    return {
      available: true,
      scanned: logs.length,
      estimated: false,
      note: '旧问答日志没有保存 QueryPlan；仅把带引用的记录计为已检索，其余标为未记录，不猜测当时的路由。新运行计划保存在 Agent Run 事件中。',
      byAction: {
        retrieve: retrieveCount,
        direct_answer: 0,
        unknown: unknownCount,
      },
      byQueryType: {
        evidence_backed: retrieveCount,
        not_recorded: unknownCount,
      },
      recent,
    };
  }
}
