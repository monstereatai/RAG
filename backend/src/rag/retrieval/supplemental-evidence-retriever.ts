import type {
  GraphFact,
  GraphService,
} from '../../modules/graph/graph.service';
import type {
  ImageIndexService,
  ImageSearchItem,
} from '../../modules/image-index/image-index.service';
import type { RetrievedChunk } from '../evidence/retrieval.types';

export interface GraphProbeResult {
  attempted: boolean;
  enabled: boolean;
  merged: boolean;
  factCount: number;
  elapsedMs: number;
  facts: GraphFact[];
  skippedReason?: string;
}

export interface ImageProbeResult {
  attempted: boolean;
  enabled: boolean;
  merged: boolean;
  hitCount: number;
  elapsedMs: number;
  hits: ImageSearchItem[];
  skippedReason?: string;
}

/** Graph 与图片索引的可选补充召回；最终合并和上下文策略由主检索服务负责。 */
export class SupplementalEvidenceRetriever {
  constructor(
    private readonly graphService?: GraphService,
    private readonly imageIndexService?: ImageIndexService,
  ) {}

  isGraphEnabled(): boolean {
    return Boolean(this.graphService?.isEnabled());
  }

  isImageEnabled(): boolean {
    return Boolean(this.imageIndexService?.isEnabled());
  }

  skippedGraphProbe(skippedReason: string): GraphProbeResult {
    return {
      attempted: false,
      enabled: this.isGraphEnabled(),
      merged: false,
      factCount: 0,
      elapsedMs: 0,
      facts: [],
      skippedReason,
    };
  }

  skippedImageProbe(skippedReason: string): ImageProbeResult {
    return {
      attempted: false,
      enabled: this.isImageEnabled(),
      merged: false,
      hitCount: 0,
      elapsedMs: 0,
      hits: [],
      skippedReason,
    };
  }

  async probeGraph(
    query: string,
    userId: string | undefined,
    isDocumentVisible: (docId: string) => boolean,
  ): Promise<GraphProbeResult> {
    const startedAt = Date.now();
    const enabled = this.isGraphEnabled();
    if (!enabled) {
      return {
        attempted: false,
        enabled: false,
        merged: false,
        factCount: 0,
        elapsedMs: 0,
        facts: [],
        skippedReason: 'disabled',
      };
    }
    if (!userId) {
      return {
        attempted: false,
        enabled: true,
        merged: false,
        factCount: 0,
        elapsedMs: 0,
        facts: [],
        skippedReason: 'missing_user',
      };
    }

    try {
      const result = await Promise.race([
        this.graphService!.queryGraph(query, userId, {
          generateAnswer: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 1200),
        ),
      ]);
      const facts = result.facts
        .flatMap((fact) => {
          const sourceIds = Array.from(
            new Set(
              [fact.sourceId, ...(fact.sourceIds ?? [])].filter(
                (sourceId): sourceId is string =>
                  typeof sourceId === 'string' && sourceId.trim().length > 0,
              ),
            ),
          );
          return sourceIds.flatMap((sourceId) =>
            isDocumentVisible(sourceId)
              ? [{ ...fact, sourceId, sourceIds: [sourceId] }]
              : [],
          );
        })
        .slice(0, 6);
      return {
        attempted: true,
        enabled: true,
        merged: false,
        factCount: facts.length,
        elapsedMs: Date.now() - startedAt,
        facts,
      };
    } catch (error) {
      return {
        attempted: true,
        enabled: true,
        merged: false,
        factCount: 0,
        elapsedMs: Date.now() - startedAt,
        facts: [],
        skippedReason: (error as Error).message,
      };
    }
  }

  async probeImages(
    query: string,
    userId: string | undefined,
    allowedDocIds: ReadonlySet<string> | undefined,
    isDocumentVisible: (docId: string) => boolean,
  ): Promise<ImageProbeResult> {
    const startedAt = Date.now();
    const enabled = this.isImageEnabled();
    if (!enabled) {
      return {
        attempted: false,
        enabled: false,
        merged: false,
        hitCount: 0,
        elapsedMs: 0,
        hits: [],
        skippedReason: 'disabled',
      };
    }
    if (!userId || !allowedDocIds) {
      return {
        attempted: false,
        enabled: true,
        merged: false,
        hitCount: 0,
        elapsedMs: 0,
        hits: [],
        skippedReason: 'missing_user_acl',
      };
    }

    try {
      const searchedHits = await Promise.race([
        this.imageIndexService!.searchText(query, {
          topK: 6,
          userId,
          allowedDocIds,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 1200),
        ),
      ]);
      const hits = searchedHits.filter((hit) => isDocumentVisible(hit.docId));
      return {
        attempted: true,
        enabled: true,
        merged: false,
        hitCount: hits.length,
        elapsedMs: Date.now() - startedAt,
        hits,
      };
    } catch (error) {
      return {
        attempted: true,
        enabled: true,
        merged: false,
        hitCount: 0,
        elapsedMs: Date.now() - startedAt,
        hits: [],
        skippedReason: (error as Error).message,
      };
    }
  }

  imageHitToChunk(hit: ImageSearchItem, index: number): RetrievedChunk {
    const meta = hit.meta ?? {};
    const description =
      typeof meta.description === 'string' ? meta.description : '图片语义证据';
    const placement =
      typeof meta.placement === 'string' ? `，位置：${meta.placement}` : '';
    return {
      id: `image:${hit.docId}:${index}`,
      content: `${description}${placement}\n图片地址：${hit.url}\n来源文档：${hit.docId}`,
      docId: hit.docId,
      chunkIndex: typeof meta.chunkIndex === 'number' ? meta.chunkIndex : index,
      bm25Score: 0,
      cosineScore: hit.score,
      totalScore: Math.max(0.1, hit.score),
      retrievalSource: 'vector',
      contextRole: 'hit',
      ...(typeof meta.lifecycleStatus === 'string'
        ? { lifecycleStatus: meta.lifecycleStatus }
        : {}),
    };
  }

  graphFactToChunk(fact: GraphFact, index: number): RetrievedChunk {
    return {
      id: `graph:${fact.sourceId}:${fact.source}:${fact.target}:${index}`,
      content: `${fact.sourceLabel}（${fact.source}）—${fact.relationship}→${fact.targetLabel}（${fact.target}）\n来源：${fact.sourceId}`,
      docId: fact.sourceId,
      chunkIndex: index,
      bm25Score: 0,
      cosineScore: 0,
      totalScore: Math.max(0.1, fact.confidence * 0.2),
      retrievalSource: 'expansion',
      contextRole: 'hit',
    };
  }
}
