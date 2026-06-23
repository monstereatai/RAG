import { Injectable } from '@nestjs/common';
import { RagClientService } from '../rag-client/rag-client.service';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly ragClient: RagClientService) {}

  async overview() {
    const [documents, evaluations, conversations, vectorIndex] = await Promise.all([
      this.ragClient.getDocuments({ page: 1, pageSize: 1 }),
      this.ragClient.getEvaluations(),
      this.ragClient.getConversations(),
      this.ragClient.getVectorIndex(),
    ]);

    return {
      service: 'admin-backend',
      boundary: {
        mode: 'separate-service',
        ragAccess: 'http-api-only',
        sharedPackage: false,
      },
      cards: {
        documents: this.pickTotal(documents.data),
        questions: this.pickTotal(conversations.data),
        evaluations: this.pickTotal(evaluations.data),
        activeUsers: null,
      },
      modules: [
        'users',
        'roles',
        'permissions',
        'dashboard',
        'documents',
        'rag-ops',
        'audit-logs',
        'notifications',
        'system-config',
      ],
      upstream: {
        ragService: {
          config: this.ragClient.getConfig(),
          documents,
          evaluations,
          conversations,
          vectorIndex,
        },
      },
    };
  }

  private pickTotal(data: unknown): number | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const payload = 'data' in data ? (data as { data: unknown }).data : data;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as Record<string, unknown>;
    if (typeof record.total === 'number') {
      return record.total;
    }

    if (Array.isArray(record.items)) {
      return record.items.length;
    }

    return null;
  }
}
