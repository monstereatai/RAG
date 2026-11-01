import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentImageIngestionService } from './document-image-ingestion.service';
import { DocumentIndexCoordinator } from './document-index-coordinator.service';
import { DocumentTaskService } from './document-task.service';
import { DocumentPermissionService } from './document-permission.service';
import { GraphService } from '../graph/graph.service';
import { DocumentMetadataExtractor } from './document-metadata.extractor';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import { DocumentChunkWorkflow } from './document.service.chunk-workflow';
import { MarkdownChunker } from './chunking.util';
import { detectPromptInjection } from '../../rag/prompts/prompt-injection.guard';
import {
  DocumentLifecycleStatus,
  assessIngestionQuality,
  detectGameDocumentMetadata,
  type GameDocumentMetadata,
} from './document-profile.util';
import type { Repository } from 'typeorm';
import type {
  DocumentGovernanceMetadata,
  UploadOptions,
  UploadResult,
} from './document.service.types';
import type { DomainEventInput } from '../domain-events/domain-events.service';

type GraphIndexStatus = 'pending' | 'indexed' | 'failed' | 'skipped';

interface DocumentUploadWorkflowContext {
  permissionService: DocumentPermissionService;
  logger: Logger;
  documentTaskService: DocumentTaskService;
  docMetaRepo: Repository<DocumentMetaEntity>;
  metadataExtractor: DocumentMetadataExtractor;
  graphService: GraphService;
  documentIndexCoordinator: DocumentIndexCoordinator;
  documentImageIngestionService: DocumentImageIngestionService;
  dingTalk?: DingTalkProvider;
  chunkWorkflow: DocumentChunkWorkflow;
  saveOriginalResource: (params: {
    docId: string;
    taskId: string;
    userId: string;
    tenantId?: string;
    filename: string;
    buffer: Buffer;
    contentType?: string;
  }) => Promise<string>;
  resolveChunkStrategy: (
    business: GameDocumentMetadata,
  ) => Promise<{ chunkSize: number; chunkOverlap: number }>;
  cleanupFailedExternalIndexes: (
    docId: string,
    userId: string,
  ) => Promise<void>;
  scheduleOptionalGraphIndex: (params: {
    docId: string;
    userId: string;
    indexGeneration: string;
  }) => void;
  updateLifecycle: (
    docId: string,
    userId: string,
    lifecycleStatus: DocumentLifecycleStatus,
    event?: DomainEventInput,
  ) => Promise<boolean>;
  rebuildRetrievalDescriptions: (
    tenantId: string,
    docId: string,
  ) => Promise<void>;
}

export class DocumentUploadWorkflow {
  constructor(private readonly context: DocumentUploadWorkflowContext) {}

  async upload(
    filename: string,
    content: string,
    userId: string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    await this.context.permissionService.assertTenant(
      userId,
      options.tenantId,
      options.trustedAdminPrincipal,
    );
    const docId = options.docId ?? randomUUID();
    const taskId = options.taskId ?? randomUUID();
    this.context.logger.log(
      `Uploading ${filename}, docId=${docId}, userId=${userId}`,
    );
    await this.context.documentTaskService.upsertTask(taskId, {
      docId,
      userId,
      filename,
      status: 'processing',
      stage: 'parsing',
      progress: 10,
      startedAt: new Date(),
    });

    let originalUrl: string | null = null;
    try {
      if (options.originalBuffer) {
        originalUrl = await this.context.saveOriginalResource({
          docId,
          taskId,
          userId,
          tenantId: options.tenantId,
          filename,
          buffer: options.originalBuffer,
          contentType: options.contentType,
        });
      }

      if (options.parsedDocument) {
        const hasUsableBlock = options.parsedDocument.blocks.some(
          (block) => block.text.trim() || block.asset?.url,
        );
        if (
          options.parsedDocument.status === 'failed' ||
          !options.parsedDocument.markdown.trim() ||
          !hasUsableBlock
        ) {
          const details = options.parsedDocument.warnings
            .map((warning) => `${warning.code}: ${warning.message}`)
            .join('; ');
          throw new Error(
            `document parsing failed; refusing to index invalid content${details ? `: ${details}` : ''}`,
          );
        }
      }

      // 安全门禁必须在切块与索引之前：高风险内容只能保留原始证据供人工审核，
      // 不能进入任何可被检索或被模型读取的存储。
      const promptInjectionFindings = detectPromptInjection(content);
      const highRiskPromptInjection = promptInjectionFindings.filter(
        (finding) => finding.severity === 'high',
      );
      if (highRiskPromptInjection.length > 0) {
        // 隔离时仍保留原始资料，供人工复核；不进入切片和任何检索索引。
        if (!options.originalBuffer) {
          await this.context.saveOriginalResource({
            docId,
            taskId,
            userId,
            tenantId: options.tenantId,
            filename,
            buffer: Buffer.from(content, 'utf8'),
            contentType: options.contentType ?? 'text/plain',
          });
        }
        const patterns = highRiskPromptInjection
          .map((finding) => finding.pattern)
          .join(', ');
        this.context.logger.warn(
          `Document quarantined for prompt injection review: docId=${docId}, patterns=${patterns}`,
        );
        throw new Error(
          `document quarantined for security review: ${patterns}`,
        );
      }

      const detectedBusiness = detectGameDocumentMetadata(filename, content);
      const business = this.context.chunkWorkflow.mergeBusinessMetadata(
        detectedBusiness,
        options.businessMetadata,
      );
      const strategy = await this.context.resolveChunkStrategy(business);
      const structuredChunks = await new MarkdownChunker(
        strategy.chunkSize,
        strategy.chunkOverlap,
      ).splitStructured(content);
      const hypotheticalQuestions = structuredChunks.map((chunk) =>
        this.context.chunkWorkflow.buildHypotheticalQuestions(
          chunk.content,
          chunk.headingPath,
        ),
      );
      const chunks = structuredChunks.map((chunk) => chunk.content);
      const ingestionQuality = assessIngestionQuality(
        content,
        structuredChunks,
        options.parsedDocument,
      );
      const contentSha256 = createHash('sha256').update(content).digest('hex');
      const indexGeneration = createHash('sha256')
        .update(`${docId}:${contentSha256}:${business.docVersion ?? ''}`)
        .digest('hex');
      const existingDocs = await this.context.docMetaRepo.find({
        where: { userId },
      });
      const duplicate = existingDocs.find((item) => {
        try {
          return (
            (
              JSON.parse(item.ingestionQuality ?? '{}') as {
                contentSha256?: string;
              }
            ).contentSha256 === contentSha256
          );
        } catch {
          return false;
        }
      });
      if (duplicate && duplicate.docId !== docId) {
        ingestionQuality.warnings.push(
          `检测到与文档 ${duplicate.docId} 内容相同的版本`,
        );
      }
      const mediumRiskPromptInjection = promptInjectionFindings.filter(
        (finding) => finding.severity === 'medium',
      );
      if (mediumRiskPromptInjection.length > 0) {
        ingestionQuality.warnings.push(
          `检测到需留意的提示注入文本：${mediumRiskPromptInjection
            .map((finding) => finding.pattern)
            .join('、')}`,
        );
      }
      const extractedGovernance =
        this.context.chunkWorkflow.extractGovernanceMetadata(filename, content);
      const governance: DocumentGovernanceMetadata = {
        // 自动识别结果提供默认值；调用方传入的业务字段优先，并单独解析版本有效期。
        ...extractedGovernance,
        ...business,
        docVersion: business.docVersion ?? extractedGovernance.docVersion,
        effectiveAt:
          this.context.chunkWorkflow.parseDateOverride(business.effectiveAt) ??
          extractedGovernance.effectiveAt,
        expiredAt:
          this.context.chunkWorkflow.parseDateOverride(business.expiredAt) ??
          extractedGovernance.expiredAt,
        changeType: business.changeType ?? 'standalone',
        validityMonths: business.validityMonths,
      };
      if (!ingestionQuality.accepted) {
        throw new Error(
          `document failed ingestion quality gate: ${JSON.stringify({
            parseStatus: ingestionQuality.parseStatus,
            parseCompleteness: ingestionQuality.parseCompleteness,
            warnings: ingestionQuality.warnings,
          })}`,
        );
      }
      this.context.logger.log(`Split into ${chunks.length} chunks`);
      // 入库阶段统一先写 draft；若治理元数据指定了其它状态，主索引完成后再切换。
      const indexingGovernance: DocumentGovernanceMetadata = {
        ...governance,
        lifecycleStatus: 'draft',
      };
      const records = chunks.map((chunk, idx) => ({
        id: randomUUID(),
        content: chunk,
        docId,
        chunkIndex: idx,
        userId,
        tenantId: options.tenantId ?? 'legacy',
        contentHash: createHash('sha256').update(chunk).digest('hex'),
        indexGeneration,
      }));
      const chunkDocs = chunks.map((chunk, idx) => ({
        id: records[idx].id,
        content: chunk,
        docId,
        chunkIndex: idx,
        userId,
        tenantId: options.tenantId ?? 'legacy',
        contentHash: createHash('sha256').update(chunk).digest('hex'),
        indexGeneration,
        parentChunkId: structuredChunks[idx]?.parentChunkId ?? null,
        headingPath: structuredChunks[idx]?.headingPath ?? [],
        sectionId: structuredChunks[idx]?.sectionId ?? null,
        clauseId: structuredChunks[idx]?.clauseId ?? null,
        tableRef: structuredChunks[idx]?.tableRef ?? null,
        sourceStart: structuredChunks[idx]?.sourceStart ?? null,
        sourceEnd: structuredChunks[idx]?.sourceEnd ?? null,
        ruleKey: this.context.chunkWorkflow.resolveRuleKey(
          structuredChunks[idx],
          idx,
        ),
        changeType: governance.changeType ?? 'standalone',
        supersedesChunkId: null,
        docVersion: indexingGovernance.docVersion,
        effectiveAt: this.context.chunkWorkflow.resolveChunkValidity(
          chunk,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).effectiveAt,
        expiredAt: this.context.chunkWorkflow.resolveChunkValidity(
          chunk,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).expiredAt,
        sourceAuthority: indexingGovernance.sourceAuthority,
        projectId: indexingGovernance.projectId,
        activityId: indexingGovernance.activityId,
        region: indexingGovernance.region,
        locale: indexingGovernance.locale,
        channel: indexingGovernance.channel,
        roleScope: indexingGovernance.roleScope,
        documentType: indexingGovernance.documentType,
        lifecycleStatus: indexingGovernance.lifecycleStatus,
        reviewStatus:
          indexingGovernance.lifecycleStatus === 'draft' ? 'draft' : 'approved',
        supersedesDocId: indexingGovernance.supersedesDocId,
        hypotheticalQuestions: hypotheticalQuestions[idx],
      }));
      if (options.incrementalUpdate) {
        return this.context.chunkWorkflow.applyIncrementalChunkUpdate({
          docId,
          userId,
          tenantId: options.tenantId ?? 'legacy',
          filename,
          content,
          contentSha256,
          indexGeneration,
          chunkDocs,
          governance,
          taskId,
          options,
        });
      }

      // 标题、摘要等 LLM 元数据是增强信息；失败记为缺失，不阻断正文索引。
      const metadataPromise = options.preserveExistingMetadata
        ? Promise.resolve(null)
        : this.context.metadataExtractor.extract(content).catch((err) => {
            this.context.logger.warn(
              `Metadata extraction failed: ${(err as Error).message}`,
            );
            return null;
          });

      const docMeta = this.context.docMetaRepo.create({
        docId,
        tenantId: options.tenantId ?? 'legacy',
        filename,
        contentHash: contentSha256,
        indexGeneration,
        changeType: governance.changeType ?? 'standalone',
        chunkCount: chunks.length,
        userId,
        docVersion: indexingGovernance.docVersion,
        effectiveAt: indexingGovernance.effectiveAt,
        expiredAt: indexingGovernance.expiredAt,
        sourceAuthority: indexingGovernance.sourceAuthority,
        projectId: indexingGovernance.projectId,
        activityId: indexingGovernance.activityId,
        region: indexingGovernance.region,
        locale: indexingGovernance.locale,
        channel: indexingGovernance.channel,
        roleScope:
          indexingGovernance.roleScope.length > 0
            ? JSON.stringify(indexingGovernance.roleScope)
            : null,
        documentType: indexingGovernance.documentType,
        lifecycleStatus: indexingGovernance.lifecycleStatus,
        supersedesDocId: indexingGovernance.supersedesDocId,
        ingestionQuality: JSON.stringify({
          ...ingestionQuality,
          contentSha256,
        }),
        chunkStrategy: JSON.stringify(strategy),
        graphIndexStatus: this.context.graphService.isEnabled()
          ? 'pending'
          : 'skipped',
      });

      // 嵌入提前到并行入库之前：同一条向量既要写 Milvus，也要随 chunk 写入 ES（dense_vector kNN 通道）。
      // 失败语义与原先一致：嵌入失败 => 清理外部索引并整体入库失败（原先对应 allSettled 首分支拒绝路径）。
      await this.context.documentTaskService.updateTask(taskId, {
        stage: 'embedding',
        progress: 30,
      });
      let vectors: number[][];
      try {
        vectors =
          await this.context.documentIndexCoordinator.embedChunks(chunks);
      } catch (embeddingErr) {
        await this.context.cleanupFailedExternalIndexes(docId, userId);
        throw embeddingErr;
      }
      await this.context.documentTaskService.updateTask(taskId, {
        stage: 'vector_index',
        progress: 50,
      });

      // 四个必要落点彼此独立，因此并发降低等待时间；allSettled 用于收集所有结果，
      // 以便后续对已成功的外部索引做一致的补偿清理。
      const indexResults = await Promise.allSettled([
        this.context.documentIndexCoordinator.writeDocumentIndexes({
          records,
          chunks: chunkDocs,
          userId,
          vectors,
          document: {
            docId,
            filename,
            content,
            userId,
            tenantId: options.tenantId ?? 'legacy',
            title: filename,
            sourceAuthority: indexingGovernance.sourceAuthority,
            projectId: indexingGovernance.projectId,
            activityId: indexingGovernance.activityId,
            region: indexingGovernance.region,
            locale: indexingGovernance.locale,
            channel: indexingGovernance.channel,
            roleScope: indexingGovernance.roleScope,
            documentType: indexingGovernance.documentType,
            lifecycleStatus: indexingGovernance.lifecycleStatus,
            docVersion: indexingGovernance.docVersion,
            contentHash: contentSha256,
            indexGeneration,
            effectiveAt: indexingGovernance.effectiveAt,
            expiredAt: indexingGovernance.expiredAt,
          },
        }),
        (async () => {
          await this.context.docMetaRepo.save(docMeta);
          if (!options.preservePermissions) {
            await this.context.permissionService.grantOwner(docId, userId);
          }
          await this.context.chunkWorkflow.saveChunkMetadata(
            docId,
            userId,
            records,
            structuredChunks,
            indexingGovernance,
            hypotheticalQuestions,
            options.tenantId ?? 'legacy',
            indexGeneration,
          );
          await this.context.chunkWorkflow.detectAndSaveFactConflicts(
            docId,
            userId,
            records,
            indexingGovernance,
          );
        })(),
        options.onQualityAccepted?.(docId) ?? Promise.resolve(),
      ]);
      const failedIndex = indexResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failedIndex) {
        await this.context.cleanupFailedExternalIndexes(docId, userId);
        throw failedIndex.reason;
      }

      // 图片检索是可选索引：文档中的本地图片资产与原始图片统一替换为完整集合。
      let imageIndexResult: UploadResult['imageIndex'];
      if (this.context.documentImageIngestionService.isEnabled()) {
        const imageIndexPromise =
          this.context.documentImageIngestionService.indexDocumentImages({
            docId,
            userId,
            filename,
            content,
            originalUrl,
            originalBuffer: options.originalBuffer,
          });
        const handleImageIndexError = (err: Error) =>
          this.context.logger.warn(
            `Image index failed for docId=${docId}: ${err.message}`,
          );
        if (options.awaitImageIndex) {
          try {
            const assetCount = await imageIndexPromise;
            imageIndexResult = { indexed: true, assetCount };
          } catch (err) {
            const error = err as Error;
            handleImageIndexError(error);
            imageIndexResult = {
              indexed: false,
              assetCount: 0,
              reason: error.message,
            };
          }
        } else {
          void imageIndexPromise.catch(handleImageIndexError);
        }
      }
      const graphIndexStatus: GraphIndexStatus =
        this.context.graphService.isEnabled() ? 'pending' : 'skipped';
      if (graphIndexStatus === 'pending') {
        this.context.scheduleOptionalGraphIndex({
          docId,
          userId,
          indexGeneration,
        });
      }
      await this.context.documentTaskService.updateTask(taskId, {
        stage: 'metadata',
        progress: 80,
      });

      const metadata = await metadataPromise;
      if (metadata) {
        await this.context.docMetaRepo.update(
          { docId },
          {
            title: metadata.title || null,
            author: metadata.author || null,
            summary: metadata.summary || null,
            keywords:
              metadata.keywords.length > 0
                ? JSON.stringify(metadata.keywords)
                : null,
            language: metadata.language || null,
            category: metadata.category || null,
          },
        );
        this.context.logger.log(
          `Metadata saved: docId=${docId}, title="${metadata.title}", category=${metadata.category}`,
        );
      }

      // 描述索引依赖 PostgreSQL 中已保存的摘要和原文块，因此必须在元数据落库后构建。
      // 非 draft 文档由生命周期更新统一重建，避免同一文档重复生成向量。
      if (governance.lifecycleStatus !== 'draft') {
        await this.context.updateLifecycle(
          docId,
          userId,
          governance.lifecycleStatus,
        );
      } else {
        await this.context.rebuildRetrievalDescriptions(
          options.tenantId ?? 'legacy',
          docId,
        );
      }

      await this.context.documentTaskService.updateTask(taskId, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        chunkCount: chunks.length,
        finishedAt: new Date(),
      });

      this.context.logger.log(
        `Upload done: docId=${docId}, chunks=${
          chunks.length
        }, esEnabled=${this.context.documentIndexCoordinator.isElasticsearchEnabled()}`,
      );
      return {
        docId,
        taskId,
        chunkCount: chunks.length,
        docVersion: governance.docVersion,
        effectiveAt: governance.effectiveAt?.toISOString() ?? null,
        expiredAt: governance.expiredAt?.toISOString() ?? null,
        sourceAuthority: governance.sourceAuthority,
        projectId: governance.projectId,
        activityId: governance.activityId,
        region: governance.region,
        locale: governance.locale,
        channel: governance.channel,
        roleScope: governance.roleScope,
        documentType: governance.documentType,
        lifecycleStatus: governance.lifecycleStatus,
        graphIndexStatus,
        ...(imageIndexResult ? { imageIndex: imageIndexResult } : {}),
        supersedesDocId: governance.supersedesDocId,
        ingestionQuality,
        chunkStrategy: strategy,
        metadata: metadata || undefined,
      };
    } catch (err) {
      const message = (err as Error).message;
      await this.context.documentTaskService.updateTask(taskId, {
        status: 'failed',
        stage: message.startsWith('document quarantined for security review:')
          ? 'security_review'
          : 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      });
      // 钉钉告警（fire-and-forget）
      void this.context.dingTalk?.notifyAlert(
        `document.failed:${taskId}`,
        `**文档入库任务失败**（taskId：\`${taskId}\`）\n\n错误：${message.slice(0, 300)}`,
      );
      throw err;
    }
  }
}
