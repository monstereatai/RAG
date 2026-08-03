import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackService } from './rag-feedback.service';

describe('RagFeedbackService', () => {
  function createService(queryLog: Partial<QueryLogEntity> | null) {
    const feedbackRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    } as unknown as Repository<RagFeedbackEntity>;
    const queryLogRepo = {
      findOne: jest.fn().mockResolvedValue(queryLog),
    } as unknown as Repository<QueryLogEntity>;
    const badCaseFlywheel = {
      indexApproved: jest.fn().mockResolvedValue({ indexed: true }),
    };
    return {
      service: new RagFeedbackService(
        feedbackRepo,
        queryLogRepo,
        badCaseFlywheel as never,
      ),
      feedbackRepo,
      badCaseFlywheel,
    };
  }

  it('copies the server-side retrieval snapshot into a bad case', async () => {
    const { service, feedbackRepo } = createService({
      id: '11111111-1111-4111-8111-111111111111',
      threadId: '22222222-2222-4222-8222-222222222222',
      userId: 'user-1',
      retrievalSnapshot: '[{"docId":"doc-1"}]',
    });

    await service.create(
      {
        queryLogId: '11111111-1111-4111-8111-111111111111',
        feedback: 'negative',
        errorType: 'citation_error',
        comment: '引用没有支撑结论',
      },
      'user-1',
    );

    expect(feedbackRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLogId: '11111111-1111-4111-8111-111111111111',
        retrievalSnapshot: '[{"docId":"doc-1"}]',
        feedback: 'negative',
        status: 'pending',
      }),
    );
  });

  it('requires a query log or thread identifier', async () => {
    const { service } = createService(null);
    await expect(
      service.create({ feedback: 'positive' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not accept feedback for a query outside the user scope', async () => {
    const { service } = createService(null);
    await expect(
      service.create(
        {
          queryLogId: '11111111-1111-4111-8111-111111111111',
          feedback: 'negative',
        },
        'user-2',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('indexes only reviewed negative feedback with an approved correction', async () => {
    const queryLog = {
      id: '11111111-1111-4111-8111-111111111111',
      query: '泰语活动页换行规则是什么？',
      answer: '错误回答',
    } as QueryLogEntity;
    const { service, feedbackRepo, badCaseFlywheel } = createService(queryLog);
    (feedbackRepo as unknown as { findOne: jest.Mock }).findOne = jest
      .fn()
      .mockResolvedValue({
        id: 'feedback-1',
        queryLogId: queryLog.id,
        feedback: 'negative',
        correctedAnswer: null,
        includeInRegression: false,
        status: 'pending',
        errorType: 'incomplete_answer',
      });

    await service.review('feedback-1', {
      status: 'reviewed',
      correctedAnswer: '泰语按词组断行，并覆盖窄屏验收。',
      includeInRegression: true,
      reviewedBy: 'admin-1',
    });

    expect(badCaseFlywheel.indexApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        query: queryLog.query,
        wrongAnswer: queryLog.answer,
        correctedAnswer: '泰语按词组断行，并覆盖窄屏验收。',
      }),
    );
  });
});
