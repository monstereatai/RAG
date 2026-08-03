import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { ChatFeedbackDto } from './chat-feedback.dto';
import { BadCaseFlywheelService } from '../../rag/prompts/bad-case-flywheel.service';

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
  ) {}

  async create(
    dto: ChatFeedbackDto,
    userId: string,
  ): Promise<RagFeedbackEntity> {
    if (!dto.queryLogId && !dto.threadId) {
      throw new BadRequestException('queryLogId or threadId is required');
    }
    const queryLog = dto.queryLogId
      ? await this.queryLogRepo.findOne({
          where: { id: dto.queryLogId, userId },
        })
      : await this.queryLogRepo.findOne({
          where: { threadId: dto.threadId, userId },
          order: { createdAt: 'DESC' },
        });
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
  ): Promise<RagFeedbackEntity> {
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
    if (
      saved.feedback === 'negative' &&
      saved.correctedAnswer &&
      saved.includeInRegression &&
      (saved.status === 'reviewed' || saved.status === 'resolved')
    ) {
      const queryLog = saved.queryLogId
        ? await this.queryLogRepo.findOne({ where: { id: saved.queryLogId } })
        : null;
      if (queryLog) {
        await this.badCaseFlywheel.indexApproved({
          id: saved.id,
          query: queryLog.query,
          wrongAnswer: queryLog.answer ?? '',
          correctedAnswer: saved.correctedAnswer,
          errorType: saved.errorType,
        });
      }
    }
    return saved;
  }
}
