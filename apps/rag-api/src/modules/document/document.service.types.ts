import type {
  DocumentBusinessMetadata,
  DocumentChangeType,
  DocumentLifecycleStatus,
  GameDocumentMetadata,
  GameDocumentType,
  IngestionQualityReport,
} from './document-profile.util';
import type { ParsedDocument } from './document-parser.types';

export interface UploadResult {
  docId: string;
  chunkCount: number;
  taskId?: string;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: GameDocumentType;
  lifecycleStatus?: DocumentLifecycleStatus;
  graphIndexStatus?: GraphIndexStatus;
  graphIndexedAt?: string | null;
  graphIndexError?: string | null;
  imageIndex?: { indexed: boolean; assetCount: number; reason?: string };
  supersedesDocId?: string | null;
  ingestionQuality?: IngestionQualityReport;
  chunkStrategy?: { chunkSize: number; chunkOverlap: number };
  incremental?: {
    added: number;
    changed: number;
    removed: number;
    unchanged: number;
    embedded: number;
  };
  metadata?: {
    title: string;
    author: string;
    summary: string;
    keywords: string[];
    language: string;
    category: string;
  };
}

export type IncrementalChunkDraft = {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  userId: string;
  tenantId: string;
  contentHash: string;
  indexGeneration: string;
  parentChunkId: string | null;
  headingPath: string[];
  sectionId: string | null;
  clauseId: string | null;
  tableRef: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  parentContent?: string | null;
  sourceMetadata?: string | null;
  ruleKey: string | null;
  changeType: string;
  supersedesChunkId: string | null;
  docVersion: string | null;
  effectiveAt: Date | null;
  expiredAt: Date | null;
  sourceAuthority: string;
  projectId: string | null;
  activityId: string | null;
  region: string | null;
  locale: string | null;
  channel: string | null;
  roleScope: string[];
  documentType: string;
  lifecycleStatus: string;
  reviewStatus: string;
  supersedesDocId: string | null;
  hypotheticalQuestions: string[];
};

export interface UploadOptions {
  docId?: string;
  taskId?: string;
  /** 修复已有文档时保留当前 ACL 和人工维护的元数据。 */
  preservePermissions?: boolean;
  /** 同一 docId 的 chunk 级增量更新；只重算新增/变化的 chunk。 */
  incrementalUpdate?: boolean;
  preserveExistingMetadata?: boolean;
  awaitImageIndex?: boolean;
  /** Worker／跨服务调用携带的租户上下文；持久化租户列仍需后续迁移补齐。 */
  tenantId?: string;
  /** Internal Admin bridge only; the caller must be authenticated by ServiceTokenGuard. */
  trustedAdminPrincipal?: boolean;
  originalBuffer?: Buffer;
  contentType?: string;
  parsedDocument?: ParsedDocument;
  businessMetadata?: DocumentBusinessMetadata;
  onQualityAccepted?: (docId: string) => Promise<void>;
}

export interface DocMeta extends UploadResult {
  filename: string;
  createdAt: string;
  reviewStatus?: 'draft' | 'pending_review' | 'approved' | 'rejected';
  reviewedAt?: string | null;
  reviewComment?: string | null;
}

type GraphIndexStatus = 'pending' | 'indexed' | 'failed' | 'skipped';

export interface DocumentGovernanceMetadata extends GameDocumentMetadata {
  docVersion: string | null;
  effectiveAt: Date | null;
  expiredAt: Date | null;
  sourceAuthority: string;
  changeType?: DocumentChangeType;
  validityMonths?: number;
}

export interface FactConflictDraft {
  subject: string;
  predicate: string;
  currentValue: string;
  conflictingValue: string;
  conflictingVersion: string | null;
}
