import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RetrievedChunk } from '../rag/karpathy/karpathy-rag.service';

interface RerankResultItem {
  index?: unknown;
  relevance_score?: unknown;
}

interface CompatibleRerankResponse {
  results?: RerankResultItem[];
  output?: {
    results?: RerankResultItem[];
  };
}

@Injectable()
export class DashScopeRerankService {
  private readonly logger = new Logger(DashScopeRerankService.name);
  private readonly textRerankEndpoint =
    'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank';

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.config.get<string>('rerank.apiKey'));
  }

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topN = chunks.length,
    signal?: AbortSignal,
  ): Promise<RetrievedChunk[]> {
    const apiKey = this.config.get<string>('rerank.apiKey');
    if (!apiKey || chunks.length < 2) {
      return chunks;
    }

    const model = this.config.get<string>('rerank.model') ?? 'qwen3-rerank';
    const endpoint =
      this.config.get<string>('rerank.baseUrl') ?? this.textRerankEndpoint;
    const response = await fetch(
      model === 'qwen3-rerank' ? endpoint : this.textRerankEndpoint,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.buildRequestBody(model, query, chunks, topN)),
        signal: this.composeSignal(signal, 10_000),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `DashScope rerank failed: ${response.status} ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as CompatibleRerankResponse;
    const results = payload.results ?? payload.output?.results ?? [];
    const ranked = results
      .map((item): RetrievedChunk | null => {
        const index =
          typeof item.index === 'number' && Number.isInteger(item.index)
            ? item.index
            : -1;
        const score =
          typeof item.relevance_score === 'number'
            ? item.relevance_score
            : undefined;
        const chunk = chunks[index];
        if (!chunk || score === undefined) return null;
        return { ...chunk, totalScore: score };
      })
      .filter((chunk): chunk is RetrievedChunk => chunk !== null);

    if (ranked.length === 0) {
      this.logger.warn('DashScope rerank returned no valid results');
      return chunks;
    }

    this.logger.log(
      `DashScope reranked ${ranked.length}/${chunks.length} chunks`,
    );
    return ranked;
  }

  private buildRequestBody(
    model: string,
    query: string,
    chunks: RetrievedChunk[],
    topN: number,
  ): unknown {
    const documents = chunks.map((chunk) => chunk.content.slice(0, 4000));

    if (model === 'qwen3-rerank') {
      return {
        model,
        query,
        documents,
        top_n: Math.min(topN, documents.length),
        instruct:
          'Given a web search query, retrieve relevant passages that answer the query.',
      };
    }

    return {
      model,
      input: {
        query,
        documents,
      },
      parameters: {
        top_n: Math.min(topN, documents.length),
        return_documents: false,
      },
    };
  }

  private composeSignal(signal: AbortSignal | undefined, timeoutMs: number) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }
}
