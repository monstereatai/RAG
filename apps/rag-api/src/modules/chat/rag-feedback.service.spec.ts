import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackService } from './rag-feedback.service';

describe('RagFeedbackService', () => {
  function createService(
    queryLog: Partial<QueryLogEntity> | null,
    documentService?: { upload: jest.Mock },
  ) {
    const feedbackCreateMock = jest.fn(
      (value: Partial<RagFeedbackEntity>) => value,
    );
    const feedbackRepo = {
      create: feedbackCreateMock,
      save: jest.fn((value) => Promise.resolve(value)),
    } as unknown as Repository<RagFeedbackEntity>;
    const queryLogRepo = {
      findOne: jest.fn().mockResolvedValue(queryLog),
    } as unknown as Repository<QueryLogEntity>;
    const badCaseFlywheel = {
      indexApproved: jest.fn().mockResolvedValue({ indexed: true }),
      removeApproved: jest
        .fn()
        .mockResolvedValue({ indexed: false, removed: true }),
    };
    const conversationService = {
      get: jest.fn().mockResolvedValue(null),
    };
    return {
      service: new RagFeedbackService(
        feedbackRepo,
        queryLogRepo,
        badCaseFlywheel as never,
        conversationService as never,
        undefined,
        documentService as never,
      ),
      feedbackRepo,
      feedbackCreateMock,
      badCaseFlywheel,
    };
  }

  it('copies the server-side retrieval snapshot into a bad case', async () => {
    const { service, feedbackCreateMock } = createService({
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

    expect(feedbackCreateMock).toHaveBeenCalledWith(
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

  it('indexes an approved correction even when it is not added to the regression set', async () => {
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
      includeInRegression: false,
      reviewedBy: 'admin-1',
    });

    expect(badCaseFlywheel.indexApproved).toHaveBeenCalled();
  });

  it('promotes an approved correction into a governed formal document', async () => {
    const queryLog = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      query: '泰语活动页换行规则是什么？',
      answer: '错误回答',
    } as QueryLogEntity;
    let uploadedRequest:
      | {
          filename: string;
          content: string;
          userId: string;
          options?: { businessMetadata?: Record<string, unknown> };
        }
      | undefined;
    const uploadMock = jest.fn(
      (
        filename: string,
        content: string,
        userId: string,
        options?: { businessMetadata?: Record<string, unknown> },
      ) => {
        uploadedRequest = { filename, content, userId, options };
        return Promise.resolve({
          docId: 'formal-doc-1',
          docVersion: '2026-08-v2',
        });
      },
    );
    const documentService = { upload: uploadMock };
    const { service, feedbackRepo, badCaseFlywheel } = createService(
      queryLog,
      documentService,
    );
    (feedbackRepo as unknown as { findOne: jest.Mock }).findOne = jest
      .fn()
      .mockResolvedValue({
        id: 'feedback-1',
        queryLogId: queryLog.id,
        userId: 'user-1',
        feedback: 'negative',
        correctedAnswer: '泰语按词组断行，并覆盖窄屏验收。',
        includeInRegression: false,
        status: 'reviewed',
        errorType: 'incomplete_answer',
        promotionSource: null,
      });

    const result = await service.review('feedback-1', {
      status: 'reviewed',
      reviewedBy: 'admin-1',
      promotionAction: 'promote',
      promotionSource: 'https://example.com/official-spec',
      promotionVersion: '2026-08-v2',
    });

    expect(uploadedRequest?.filename).toContain('bad-case-feedback');
    expect(uploadedRequest?.content).toContain(
      'https://example.com/official-spec',
    );
    expect(uploadedRequest?.userId).toBe('user-1');
    expect(uploadedRequest?.options?.businessMetadata?.docVersion).toBe(
      '2026-08-v2',
    );
    expect(result.knowledgeLayer).toBe('formal');
    expect(result.promotedDocument?.docId).toBe('formal-doc-1');
    expect(badCaseFlywheel.removeApproved).toHaveBeenCalledWith('feedback-1');
  });

  it('removes the vector example when an approved correction is revoked', async () => {
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
        correctedAnswer: '旧纠正答案',
        includeInRegression: true,
        status: 'reviewed',
        errorType: 'incomplete_answer',
      });

    await service.review('feedback-1', {
      status: 'ignored',
      includeInRegression: false,
      reviewedBy: 'admin-1',
    });

    expect(badCaseFlywheel.removeApproved).toHaveBeenCalledWith('feedback-1');
    expect(badCaseFlywheel.indexApproved).not.toHaveBeenCalled();
  });
});
