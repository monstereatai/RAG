import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { EvaluationCaseEntity } from '../../providers/db/entities/evaluation-case.entity';
import { ChatFeedbackDto } from './chat-feedback.dto';
import { BadCaseFlywheelService } from '../../rag/prompts/bad-case-flywheel.service';
import { ConversationService } from './conversation.service';
import { DocumentService } from '../document/document.service';

export interface ReviewRagFeedback {
  status?: RagFeedbackEntity['status'];
  errorType?: string;
  correctedAnswer?: string;
  includeInRegression?: boolean;
  reviewedBy?: string;
  promotionAction?: 'correction' | 'request' | 'promote' | 'reject';
  promotionSource?: string;
  promotionVersion?: string;
}

@Injectable()
export class RagFeedbackService {
  constructor(
    @InjectRepository(RagFeedbackEntity)
    private readonly feedbackRepo: Repository<RagFeedbackEntity>,
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo: Repository<QueryLogEntity>,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly conversationService: ConversationService,
    @Optional()
    @InjectRepository(EvaluationCaseEntity)
    private readonly evaluationCaseRepo?: Repository<EvaluationCaseEntity>,
    @Optional()
    private readonly documentService?: DocumentService,
  ) {}

  async create(
    dto: ChatFeedbackDto,
    userId: string,
    options: { allowCrossUserThread?: boolean } = {},
  ): Promise<RagFeedbackEntity> {
    if (!dto.queryLogId && !dto.threadId) {
      throw new BadRequestException('queryLogId or threadId is required');
    }
    let queryLog = dto.queryLogId
      ? await this.queryLogRepo.findOne({
          where: { id: dto.queryLogId, userId },
        })
      : await this.queryLogRepo.findOne({
          where: { threadId: dto.threadId, userId },
          order: { createdAt: 'DESC' },
        });
    if (!queryLog && options.allowCrossUserThread && dto.threadId) {
      queryLog = await this.queryLogRepo.findOne({
        where: { threadId: dto.threadId },
        order: { createdAt: 'DESC' },
      });
      if (!queryLog) {
        const conversation = await this.conversationService.get(dto.threadId);
        const lastAnswerIndex =
          conversation?.messages
            .map((message) => message.role)
            .lastIndexOf('ai') ?? -1;
        const answer =
          lastAnswerIndex >= 0
            ? (conversation?.messages[lastAnswerIndex]?.content ?? '')
            : '';
        const query =
          lastAnswerIndex > 0
            ? (conversation?.messages[lastAnswerIndex - 1]?.content ?? '')
            : (conversation?.title ?? '');
        if (conversation && query && answer) {
          queryLog = await this.queryLogRepo.save(
            this.queryLogRepo.create({
              id: randomUUID(),
              userId,
              query: query.slice(0, 2_000),
              mode: 'simple',
              threadId: dto.threadId,
              refused: false,
              citationCount: 0,
              latencyMs: 0,
              hasAnswer: true,
              answer: answer.slice(0, 20_000),
              retrievalSnapshot: '[]',
            }),
          );
        }
      }
    }
    if (!queryLog) {
      throw new NotFoundException('query log not found');
    }
    return this.feedbackRepo.save(
      this.feedbackRepo.create({
        id: randomUUID(),
        queryLogId: queryLog.id,
        threadId: queryLog.threadId,
        userId,
        feedback: dto.feedback,
        errorType: dto.errorType ?? null,
        comment: dto.comment?.trim() || null,
        correctedAnswer: dto.correctedAnswer?.trim() || null,
        retrievalSnapshot: queryLog.retrievalSnapshot,
        status: 'pending',
        includeInRegression: dto.includeInRegression ?? false,
      }),
    );
  }

  async list(
    params: {
      status?: RagFeedbackEntity['status'];
      feedback?: RagFeedbackEntity['feedback'];
      limit?: number;
    } = {},
  ) {
    const where: FindOptionsWhere<RagFeedbackEntity> = {};
    if (params.status) where.status = params.status;
    if (params.feedback) where.feedback = params.feedback;
    const feedback = await this.feedbackRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(params.limit ?? 50, 1), 200),
    });
    const logs = await this.queryLogRepo.findByIds(
      feedback.map((item) => item.queryLogId).filter(Boolean) as string[],
    );
    const logById = new Map(logs.map((log) => [log.id, log]));
    return feedback.map((item) => ({
      ...item,
      query: item.queryLogId ? logById.get(item.queryLogId)?.query : undefined,
      answer: item.queryLogId
        ? logById.get(item.queryLogId)?.answer
        : undefined,
    }));
  }

  async review(
    id: string,
    patch: ReviewRagFeedback,
  ): Promise<
    RagFeedbackEntity & {
      indexing?: Record<string, unknown>;
      evaluationCaseId?: string;
      promotedDocument?: { docId: string; docVersion: string | null };
    }
  > {
    const entity = await this.feedbackRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`feedback ${id} not found`);
    entity.status = patch.status ?? entity.status;
    entity.errorType = patch.errorType ?? entity.errorType;
    entity.correctedAnswer = patch.correctedAnswer ?? entity.correctedAnswer;
    entity.includeInRegression =
      patch.includeInRegression ?? entity.includeInRegression;
    entity.reviewedBy = patch.reviewedBy ?? entity.reviewedBy;
    entity.reviewedAt = new Date();
    if (patch.promotionAction === 'request') {
      entity.promotionStatus = 'pending';
    } else if (patch.promotionAction === 'reject') {
      entity.promotionStatus = 'rejected';
    }
    if (patch.promotionSource !== undefined) {
      entity.promotionSource = patch.promotionSource.trim() || null;
    }
    const saved = await this.feedbackRepo.save(entity);
    const correctedAnswer = saved.correctedAnswer;
    const correctionEligible =
      saved.feedback === 'negative' &&
      correctedAnswer &&
      (saved.status === 'reviewed' || saved.status === 'resolved');
    const shouldPromote = patch.promotionAction === 'promote';
    if (saved.knowledgeLayer === 'formal' && !shouldPromote) {
      // 已经晋升的内容由文档版本治理负责失效、替换和回滚，不能因再次审核
      // 意外降级回纠正层，否则会出现两层同时命中和来源不一致。
      return {
        ...saved,
        indexing: { indexed: false, reason: 'formal_document_governed' },
        ...(saved.promotedDocId
          ? {
              promotedDocument: {
                docId: saved.promotedDocId,
                docVersion: null,
              },
            }
          : {}),
      };
    }
    if (shouldPromote) {
      if (!correctionEligible) {
        throw new BadRequestException(
          '只有审核通过且包含纠正答案的 Bad Case 才能晋升正式知识',
        );
      }
      const source = saved.promotionSource?.trim();
      if (!source) {
        throw new BadRequestException(
          '晋升正式知识必须填写已核验的来源或规范文档地址',
        );
      }
      if (!this.documentService) {
        throw new BadRequestException('文档服务不可用，暂时无法晋升正式知识');
      }
      const queryLog = saved.queryLogId
        ? await this.queryLogRepo.findOne({ where: { id: saved.queryLogId } })
        : null;
      if (!queryLog) {
        throw new BadRequestException(
          '原始 Query Log 缺失，无法建立正式知识来源链路',
        );
      }
      const version =
        patch.promotionVersion?.trim() || `badcase-${saved.id.slice(0, 8)}`;
      const formalContent = this.buildPromotedKnowledgeDocument({
        query: queryLog.query,
        correctedAnswer,
        source,
        feedbackId: saved.id,
        version,
      });
      const uploaded = await this.documentService.upload(
        `bad-case-${saved.id.slice(0, 8)}-knowledge.md`,
        formalContent,
        saved.userId ?? queryLog.userId ?? 'system',
        {
          businessMetadata: {
            docVersion: version,
            effectiveAt: new Date().toISOString(),
            documentType: 'general',
            lifecycleStatus: 'effective',
          },
        },
      );
      saved.knowledgeLayer = 'formal';
      saved.promotionStatus = 'promoted';
      saved.promotedDocId = uploaded.docId;
      saved.promotedBy = saved.reviewedBy;
      saved.promotedAt = new Date();
      const promoted = await this.feedbackRepo.save(saved);
      const indexing = await this.badCaseFlywheel.removeApproved(promoted.id);
      return {
        ...promoted,
        indexing,
        promotedDocument: {
          docId: uploaded.docId,
          docVersion: uploaded.docVersion ?? null,
        },
      };
    }

    if (correctionEligible) {
      saved.knowledgeLayer = 'correction';
      const active = await this.feedbackRepo.save(saved);
      const queryLog = active.queryLogId
        ? await this.queryLogRepo.findOne({ where: { id: active.queryLogId } })
        : null;
      if (!queryLog) {
        return {
          ...active,
          indexing: { indexed: false, reason: 'query_log_missing' },
        };
      }
      let evaluationCaseId: string | undefined;
      if (active.includeInRegression && this.evaluationCaseRepo) {
        const existing = await this.evaluationCaseRepo.findOne({
          where: { sourceFeedbackId: active.id, status: 'active' },
        });
        const evaluationCase =
          existing ??
          this.evaluationCaseRepo.create({
            id: randomUUID(),
            sourceFeedbackId: active.id,
            workspaceId: 'default',
            query: queryLog.query,
            expectedAnswer: correctedAnswer,
            expectedReferences: queryLog.retrievalSnapshot || '[]',
            status: 'active',
            createdBy: active.reviewedBy ?? null,
          });
        if (existing) {
          evaluationCase.expectedAnswer = correctedAnswer;
          evaluationCase.expectedReferences =
            queryLog.retrievalSnapshot || '[]';
          evaluationCase.createdBy = active.reviewedBy ?? existing.createdBy;
        }
        const savedCase = await this.evaluationCaseRepo.save(evaluationCase);
        evaluationCaseId = savedCase.id;
      }
      let indexing: Record<string, unknown>;
      try {
        indexing = await this.badCaseFlywheel.indexApproved({
          id: active.id,
          query: queryLog.query,
          wrongAnswer: queryLog.answer ?? '',
          correctedAnswer,
          errorType: active.errorType,
        });
      } catch (error) {
        indexing = {
          indexed: false,
          reason: 'index_failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return {
        ...active,
        indexing,
        ...(evaluationCaseId ? { evaluationCaseId } : {}),
      };
    }
    saved.knowledgeLayer = 'inactive';
    const inactive = await this.feedbackRepo.save(saved);
    let indexing: Record<string, unknown>;
    try {
      indexing = await this.badCaseFlywheel.removeApproved(inactive.id);
    } catch (error) {
      indexing = {
        indexed: false,
        reason: 'remove_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (this.evaluationCaseRepo) {
      await this.evaluationCaseRepo.update(
        { sourceFeedbackId: inactive.id, status: 'active' },
        { status: 'disabled' },
      );
    }
    return { ...inactive, indexing };
  }

  private buildPromotedKnowledgeDocument(input: {
    query: string;
    correctedAnswer: string;
    source: string;
    feedbackId: string;
    version: string;
  }): string {
    return [
      '# 已审核纠正知识',
      '',
      `- 版本：${input.version}`,
      `- 来源：${input.source}`,
      `- Bad Case：${input.feedbackId}`,
      '',
      '## 适用问题',
      input.query,
      '',
      '## 已审核结论',
      input.correctedAnswer,
      '',
      '> 本文档由审核通过的 Bad Case 晋升生成；后续若正式规范变化，应以新版本文档替代本文档。',
    ].join('\n');
  }
}
