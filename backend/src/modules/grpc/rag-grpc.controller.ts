import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { DocumentService } from '../document/document.service';

// gRPC 使用 proto 中的 snake_case 字段名（keepCase: true）
interface VectorSearchRequest {
  query: string;
  user_id: string;
  top_k: number;
  mode: string;
}

interface ChunkResult {
  chunk_id: string;
  doc_id: string;
  content: string;
  bm25_score: number;
  cosine_score: number;
  fusion_score: number;
  doc_title: string;
  source_authority: string;
  chunk_index: number;
}

interface GetDocumentRequest {
  doc_id: string;
  user_id: string;
}

interface ListDocumentsRequest {
  user_id: string;
  page: number;
  page_size: number;
  query: string;
}

@Controller()
export class RagGrpcController {
  private readonly logger = new Logger(RagGrpcController.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly documentService: DocumentService,
  ) {}

  @GrpcMethod('RagService', 'VectorSearch')
  async vectorSearch(data: VectorSearchRequest) {
    const query = data.query;
    const userId = data.user_id;
    const topK = data.top_k || 5;
    this.logger.log(
      `gRPC VectorSearch: query="${query.slice(0, 50)}", userId=${userId}, topK=${topK}`,
    );

    try {
      const retrieved = await this.karpathyRagService.retrieve(
        query,
        { vectorSearch: true },
        userId || 'default',
      );

      const limited = retrieved.slice(0, topK);
      const chunks: ChunkResult[] = limited.map((chunk, index) => ({
        chunk_id: chunk.id ?? `chunk-${index}`,
        doc_id: chunk.docId ?? 'unknown',
        content: chunk.content?.slice(0, 500) ?? '',
        bm25_score: chunk.bm25Score ?? 0,
        cosine_score: chunk.cosineScore ?? 0,
        fusion_score: chunk.totalScore ?? 0,
        doc_title: '',
        source_authority: chunk.sourceAuthority ?? 'normal',
        chunk_index: chunk.chunkIndex ?? index,
      }));

      return { chunks, total: chunks.length, fallback: false };
    } catch (err) {
      this.logger.warn(`gRPC VectorSearch failed: ${(err as Error).message}`);
      return { chunks: [], total: 0, fallback: true };
    }
  }

  @GrpcMethod('RagService', 'GetDocument')
  async getDocument(data: GetDocumentRequest) {
    const docId = data.doc_id;
    const userId = data.user_id;
    const doc = await this.documentService.getDocMeta(
      docId,
      userId || 'default',
    );
    if (!doc) {
      return {
        doc_id: '',
        filename: '',
        chunk_count: 0,
        title: '',
        category: '',
        source_authority: '',
        doc_version: '',
        created_at: '',
      };
    }
    return {
      doc_id: doc.docId,
      filename: doc.filename,
      chunk_count: doc.chunkCount,
      title: doc.metadata?.title ?? doc.filename,
      category: doc.metadata?.category ?? '其他',
      source_authority: doc.sourceAuthority ?? 'normal',
      doc_version: doc.docVersion ?? 'unknown',
      created_at: doc.createdAt,
    };
  }

  @GrpcMethod('RagService', 'ListDocuments')
  async listDocuments(data: ListDocumentsRequest) {
    const userId = data.user_id;
    const page = data.page || 1;
    const pageSize = data.page_size || 20;
    const query = data.query || '';
    const docs = await this.documentService.listDocs(userId || 'default');

    let filtered = docs;
    if (query) {
      const q = query.toLowerCase();
      filtered = docs.filter(
        (doc) =>
          doc.filename.toLowerCase().includes(q) ||
          (doc.metadata?.title?.toLowerCase().includes(q) ?? false),
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      documents: items.map((doc) => ({
        doc_id: doc.docId,
        filename: doc.filename,
        chunk_count: doc.chunkCount,
        title: doc.metadata?.title ?? doc.filename,
        category: doc.metadata?.category ?? '其他',
        created_at: doc.createdAt,
      })),
      total,
      page,
      page_size: pageSize,
    };
  }

  @GrpcMethod('RagService', 'HealthCheck')
  healthCheck() {
    return {
      healthy: true,
      status: 'SERVING',
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
