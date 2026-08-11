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

export interface ReviewRagFeedback {
  status?: RagFeedbackEntity['status'];
  errorType?: string;
  correctedAnswer?: string;
  includeInRegression?: boolean;
  reviewedBy?: string;
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
            ? conversation?.messages[lastAnswerIndex]?.content ?? ''
            : '';
        const query =
          lastAnswerIndex > 0
            ? conversation?.messages[lastAnswerIndex - 1]?.content ?? ''
            : conversation?.title ?? '';
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
  ): Promise<RagFeedbackEntity & { indexing?: Record<string, unknown>; evaluationCaseId?: string }> {
    const entity = await this.feedbackRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`feedback ${id} not found`);
    entity.status = patch.status ?? entity.status;
    entity.errorType = patch.errorType ?? entity.errorType;
    entity.correctedAnswer = patch.correctedAnswer ?? entity.correctedAnswer;
    entity.includeInRegression =
      patch.includeInRegression ?? entity.includeInRegression;
    entity.reviewedBy = patch.reviewedBy ?? entity.reviewedBy;
    entity.reviewedAt = new Date();
    const saved = await this.feedbackRepo.save(entity);
    const correctedAnswer = saved.correctedAnswer;
    const shouldIndex =
      saved.feedback === 'negative' &&
      correctedAnswer &&
      saved.includeInRegression &&
      (saved.status === 'reviewed' || saved.status === 'resolved');
    if (shouldIndex) {
      const queryLog = saved.queryLogId
        ? await this.queryLogRepo.findOne({ where: { id: saved.queryLogId } })
        : null;
      if (!queryLog) {
        return {
          ...saved,
          indexing: { indexed: false, reason: 'query_log_missing' },
        };
      }
      let evaluationCaseId: string | undefined;
      if (this.evaluationCaseRepo) {
        const existing = await this.evaluationCaseRepo.findOne({
          where: { sourceFeedbackId: saved.id, status: 'active' },
        });
        const evaluationCase = existing ?? this.evaluationCaseRepo.create({
          id: randomUUID(),
          sourceFeedbackId: saved.id,
          workspaceId: 'default',
          query: queryLog.query,
          expectedAnswer: correctedAnswer,
          expectedReferences: queryLog.retrievalSnapshot || '[]',
          status: 'active',
          createdBy: saved.reviewedBy ?? null,
        });
        if (existing) {
          evaluationCase.expectedAnswer = correctedAnswer;
          evaluationCase.expectedReferences = queryLog.retrievalSnapshot || '[]';
          evaluationCase.createdBy = saved.reviewedBy ?? existing.createdBy;
        }
        const savedCase = await this.evaluationCaseRepo.save(evaluationCase);
        evaluationCaseId = savedCase.id;
      }
      let indexing: Record<string, unknown>;
      try {
        indexing = await this.badCaseFlywheel.indexApproved({
          id: saved.id,
          query: queryLog.query,
          wrongAnswer: queryLog.answer ?? '',
          correctedAnswer,
          errorType: saved.errorType,
        });
      } catch (error) {
        indexing = {
          indexed: false,
          reason: 'index_failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return { ...saved, indexing, ...(evaluationCaseId ? { evaluationCaseId } : {}) };
    }
    let indexing: Record<string, unknown>;
    try {
      indexing = await this.badCaseFlywheel.removeApproved(saved.id);
    } catch (error) {
      indexing = {
        indexed: false,
        reason: 'remove_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (this.evaluationCaseRepo) {
      await this.evaluationCaseRepo.update(
        { sourceFeedbackId: saved.id, status: 'active' },
        { status: 'disabled' },
      );
    }
    return { ...saved, indexing };
  }
}
