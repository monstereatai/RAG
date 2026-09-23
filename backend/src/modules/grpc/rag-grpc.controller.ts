import {
  Controller,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcMethod } from '@nestjs/microservices';
import { Metadata } from '@grpc/grpc-js';
import { AuthService } from '../auth/auth.service';
import { ApiTokenService } from '../auth/api-token.service';
import { IamService } from '../iam/iam.service';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { DocumentService } from '../document/document.service';

// gRPC 使用 proto 中的 snake_case 字段名（keepCase: true）
interface VectorSearchRequest {
  query: string;
  user_id?: string;
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
  user_id?: string;
}

interface ListDocumentsRequest {
  user_id?: string;
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
    private readonly authService: AuthService,
    private readonly apiTokenService: ApiTokenService,
    private readonly configService: ConfigService,
    private readonly iamService: IamService,
  ) {}

  @GrpcMethod('RagService', 'VectorSearch')
  async vectorSearch(data: VectorSearchRequest, metadata: Metadata) {
    const user = await this.authenticate(metadata, 'rag:search');
    const query = data.query;
    const userId = user.userId;
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
  async getDocument(data: GetDocumentRequest, metadata: Metadata) {
    const user = await this.authenticate(metadata, 'rag:documents');
    const docId = data.doc_id;
    const userId = user.userId;
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
  async listDocuments(data: ListDocumentsRequest, metadata: Metadata) {
    const user = await this.authenticate(metadata, 'rag:documents');
    const userId = user.userId;
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

  private async authenticate(
    metadata: Metadata,
    requiredScope: string,
  ): Promise<JwtPayload> {
    const rawAuthorization = metadata.get('authorization')[0];
    const authorization = Buffer.isBuffer(rawAuthorization)
      ? rawAuthorization.toString('utf8')
      : rawAuthorization;
    const match =
      typeof authorization === 'string'
        ? /^Bearer\s+(.+)$/i.exec(authorization)
        : null;
    const token = match?.[1]?.trim();
    if (!token) throw new UnauthorizedException('missing bearer token');

    let user: JwtPayload;
    try {
      user = await this.authService.verifyToken(token);
    } catch {
      user = await this.apiTokenService.verifyApiToken(token);
    }
    if (
      !user.userId ||
      !user.username ||
      !user.role ||
      user.type === 'refresh'
    ) {
      throw new UnauthorizedException('invalid user access token');
    }

    const tenantId = user.tenantId?.trim();
    if (
      this.configService.get<boolean>('auth.requireTenantContext') === true &&
      !tenantId
    ) {
      throw new ForbiddenException('tenant context is required');
    }
    if (
      this.configService.get<boolean>('auth.enforceIam') === true &&
      (!tenantId ||
        !(await this.iamService.hasPermission(
          user.userId,
          'platform.read',
          tenantId,
        )))
    ) {
      throw new ForbiddenException('IAM permission is insufficient');
    }
    if (
      user.authType === 'api-token' &&
      !(user.scopes ?? []).some((scope) =>
        this.scopeMatches(scope, requiredScope),
      )
    ) {
      throw new ForbiddenException('api token scope is insufficient');
    }
    return user;
  }

  private scopeMatches(granted: string, required: string): boolean {
    const normalized = granted.trim();
    return (
      normalized === '*' ||
      normalized === required ||
      (normalized.endsWith('*') && required.startsWith(normalized.slice(0, -1)))
    );
  }
}
