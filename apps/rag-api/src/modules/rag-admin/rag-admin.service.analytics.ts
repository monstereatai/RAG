import type { RagAdminServiceContext } from './rag-admin.service.context';
import { RagEvaluationRunDto } from './dto/rag-admin.dto';
import { readEvaluationReportSummaries } from '../evaluation-reports/evaluation-report.store';
import type {
  VectorIndexResponse,
  EvaluationSummary,
  ConversationSummary,
} from './rag-admin.service.types';

export class RagAdminAnalyticsWorkflow {
  constructor(private readonly context: RagAdminServiceContext) {}

  async getVectorIndex(): Promise<VectorIndexResponse> {
    const indexInfo = this.context.vectorStoreProvider.getIndexInfo();
    const runtimeStatus = this.context.vectorStoreProvider.getRuntimeStatus();
    const bm25Stats = this.context.ragService.getStats();
    const dbChunkCount = await this.context.chunkRepo.count();

    return {
      provider: indexInfo.provider,
      collectionName: indexInfo.collection,
      indexType: indexInfo.indexType,
      metricType: indexInfo.metricType,
      chunkCount: dbChunkCount || bm25Stats.totalChunks || 0,
      status: runtimeStatus.status,
      statusReason: runtimeStatus.lastFailureMessage,
      circuitState: runtimeStatus.circuitState,
      consecutiveFailures: runtimeStatus.consecutiveFailures,
      lastFailureAt: runtimeStatus.lastFailureAt,
      circuitOpenUntil: runtimeStatus.circuitOpenUntil,
      params: indexInfo.params,
    };
  }

  getEvaluations(): EvaluationSummary[] {
    return readEvaluationReportSummaries();
  }

  runEvaluation(dto: RagEvaluationRunDto) {
    const dataset = dto.dataset ?? 'rag-smoke';
    const mode = dto.mode ?? 'offline';
    const command =
      mode === 'live'
        ? 'pnpm --dir apps/rag-api eval:rag:e2e'
        : mode === 'project'
          ? 'pnpm --dir apps/rag-api eval:rag:project'
          : 'pnpm --dir apps/rag-api eval:rag';

    return {
      triggered: false,
      status: 'not_started',
      dataset,
      mode,
      command,
      note: '此接口目前不会启动评测任务；请在仓库中运行 command 字段给出的命令。',
    };
  }

  async listConversations(
    userId: string,
    tenantId: string,
  ): Promise<ConversationSummary[]> {
    const list = await this.context.conversationService.listConversations(
      userId,
      tenantId,
    );
    return list.map((item) => ({
      threadId: item.threadId,
      title: item.title,
      mode: item.mode,
      messageCount: item.messageCount,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async getConversation(threadId: string, userId: string, tenantId: string) {
    const conv = await this.context.conversationService.get(
      threadId,
      userId,
      tenantId,
    );
    if (!conv) return null;
    return {
      threadId: conv.threadId,
      title: conv.title,
      messages: conv.messages,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  async deleteConversation(
    threadId: string,
    userId: string,
    tenantId: string,
  ): Promise<boolean> {
    return this.context.conversationService.delete(threadId, userId, tenantId);
  }

  async getQueryDailyTrend(days = 14) {
    const items = await this.context.queryLogService.getDailyTrend(days);
    return { available: true, data: items };
  }

  async getSearchPopularQueries() {
    const queries = await this.context.queryLogService.getPopularQueries(20);
    return { available: true, data: queries };
  }

  async getSearchNoResultQueries() {
    const queries = await this.context.queryLogService.getNoResultQueries(20);
    return { available: true, data: queries };
  }

  async getSearchRecallIssues() {
    const issues = await this.context.queryLogService.getRecallIssues(20);
    return { available: true, data: issues };
  }

  async getQaNegativeFeedback() {
    // 用被拒答的查询作为负反馈信号
    const refused = await this.context.queryLogService.getNoResultQueries(20);
    return {
      available: true,
      data: refused,
      note: 'Negative feedback derived from refused queries. User-facing feedback collection requires frontend integration.',
    };
  }

  async getQaCitationFailures() {
    const issues = await this.context.queryLogService.getRecallIssues(20);
    return {
      available: true,
      data: issues,
      note: 'Citation failures detected from queries with 0 citations but hasAnswer=true.',
    };
  }

  async getQaCostSummary() {
    const summary = await this.context.queryLogService.getCostSummary();
    return { available: true, data: summary };
  }
}
