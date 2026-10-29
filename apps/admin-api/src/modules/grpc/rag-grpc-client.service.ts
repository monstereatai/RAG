import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Client, ClientGrpc, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { Observable } from 'rxjs';

// Proto 生成的接口类型（蛇形命名，与 proto 对齐）
export interface ChunkResult {
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

export interface VectorSearchRequest {
  query: string;
  user_id: string;
  top_k: number;
  mode: string;
}

export interface VectorSearchResponse {
  chunks: ChunkResult[];
  total: number;
  fallback: boolean;
}

export interface GetDocumentRequest {
  doc_id: string;
  user_id: string;
}

export interface GetDocumentResponse {
  doc_id: string;
  filename: string;
  chunk_count: number;
  title: string;
  category: string;
  source_authority: string;
  doc_version: string;
  created_at: string;
}

export interface ListDocumentsRequest {
  user_id: string;
  page: number;
  page_size: number;
  query: string;
}

export interface DocumentSummary {
  doc_id: string;
  filename: string;
  chunk_count: number;
  title: string;
  category: string;
  created_at: string;
}

export interface ListDocumentsResponse {
  documents: DocumentSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface HealthCheckResponse {
  healthy: boolean;
  status: string;
  uptime_seconds: number;
}

interface RagGrpcClient {
  vectorSearch(
    data: VectorSearchRequest,
  ): Observable<VectorSearchResponse>;
  getDocument(data: GetDocumentRequest): Observable<GetDocumentResponse>;
  listDocuments(
    data: ListDocumentsRequest,
  ): Observable<ListDocumentsResponse>;
  healthCheck(data: Record<string, never>): Observable<HealthCheckResponse>;
}

@Injectable()
export class RagGrpcClientService implements OnModuleInit {
  private readonly logger = new Logger(RagGrpcClientService.name);
  private ragClient: RagGrpcClient;

  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'rag',
      protoPath: join(__dirname, 'proto/rag.proto'),
      url: process.env.RAG_GRPC_URL || 'localhost:50051',
      loader: {
        keepCase: true,
        longs: String,
        enums: String,
      },
    },
  })
  private readonly client: ClientGrpc;

  onModuleInit() {
    this.ragClient = this.client.getService<RagGrpcClient>('RagService');
    this.logger.log('RAG gRPC client initialized');
  }

  async vectorSearch(
    query: string,
    userId = 'admin',
    topK = 5,
    mode = 'simple',
  ): Promise<VectorSearchResponse> {
    try {
      const response = await this.ragClient
        .vectorSearch({ query, user_id: userId, top_k: topK, mode })
        .toPromise();
      return response ?? { chunks: [], total: 0, fallback: false };
    } catch (err) {
      this.logger.warn(
        `gRPC vectorSearch failed: ${(err as Error).message}`,
      );
      return { chunks: [], total: 0, fallback: true };
    }
  }

  async getDocument(
    docId: string,
    userId = 'admin',
  ): Promise<GetDocumentResponse | null> {
    try {
      const response = await this.ragClient
        .getDocument({ doc_id: docId, user_id: userId })
        .toPromise();
      return response ?? null;
    } catch (err) {
      this.logger.warn(
        `gRPC getDocument failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async listDocuments(
    userId = 'admin',
    page = 1,
    pageSize = 20,
    query = '',
  ): Promise<ListDocumentsResponse> {
    try {
      const response = await this.ragClient
        .listDocuments({
          user_id: userId,
          page,
          page_size: pageSize,
          query,
        })
        .toPromise();
      return (
        response ?? { documents: [], total: 0, page: 1, page_size: 20 }
      );
    } catch (err) {
      this.logger.warn(
        `gRPC listDocuments failed: ${(err as Error).message}`,
      );
      return { documents: [], total: 0, page: 1, page_size: 20 };
    }
  }

  async healthCheck(): Promise<HealthCheckResponse> {
    try {
      const response = await this.ragClient.healthCheck({}).toPromise();
      return (
        response ?? {
          healthy: false,
          status: 'no_response',
          uptime_seconds: 0,
        }
      );
    } catch (err) {
      return {
        healthy: false,
        status: (err as Error).message,
        uptime_seconds: 0,
      };
    }
  }
}
