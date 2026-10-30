import { Logger } from '@nestjs/common';
import type { RagAdminService } from './rag-admin.service';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '../document/document.service';
import { DocumentPermissionService } from '../document/document-permission.service';
import { GraphService } from '../graph/graph.service';
import { ConversationService } from '../chat/conversation.service';
import { type RagAdminCapability } from '../../rag/contracts/rag-capabilities';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { QueryLogService } from './query-log.service';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentReviewEntity } from '../../providers/db/entities/document-review.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { ObsidianKnowledgeService } from '../obsidian/obsidian-knowledge.service';
import { ObsidianIngestService } from '../document/obsidian-ingest.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ImageIndexService } from '../image-index/image-index.service';
import { DocumentQueueService } from '../document/document-queue.service';
import { DocumentImageIngestionService } from '../document/document-image-ingestion.service';
import { IndexRepairQueueService } from './index-repair-queue.service';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { TencentSpeechProvider } from '../../providers/speech/tencent-speech.provider';
import { VisionProvider } from '../../providers/vision/vision.provider';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { DocumentRetrievalDescriptionService } from '../document/document-retrieval-description.service';

type PublicRagAdminCallbacks = Pick<
  RagAdminService,
  | 'reindexDocument'
  | 'auditDocumentIndexes'
  | 'promoteDocumentVersion'
  | 'listDocumentVersions'
>;
export interface RagAdminServiceContext extends PublicRagAdminCallbacks {
  configService: ConfigService;
  documentService: DocumentService;
  documentPermissionService: DocumentPermissionService;
  documentQueue: DocumentQueueService;
  obsidianIngest: ObsidianIngestService;
  graphService: GraphService;
  conversationService: ConversationService;
  ragService: RagAdminCapability;
  elasticsearchProvider: ElasticsearchProvider;
  vectorStoreProvider: VectorStoreProvider;
  queryLogService: QueryLogService;
  obsidianKnowledge: ObsidianKnowledgeService;
  chunkRepo: Repository<DocumentChunkEntity>;
  docMetaRepo: Repository<DocumentMetaEntity>;
  documentReviewRepo: Repository<DocumentReviewEntity>;
  permissionRepo: Repository<DocumentPermissionEntity>;
  domainEvents: DomainEventsService;
  embeddingProvider: EmbeddingProvider;
  retrievalDescriptionService: DocumentRetrievalDescriptionService;
  documentImageIngestionService: DocumentImageIngestionService;
  imageIndexService?: ImageIndexService;
  queryLogRepo?: Repository<QueryLogEntity>;
  indexRepairQueue?: IndexRepairQueueService;
  objectStorageProvider?: ObjectStorageProvider;
  speechProvider?: TencentSpeechProvider;
  visionProvider?: VisionProvider;
  logger: Logger;
  sanitizeObjectKeyPart: (value: string) => string;
}
