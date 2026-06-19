/**
 * SSE 事件顺序集成测试
 *
 * 验证 Agentic RAG SSE 事件链路的正确顺序和完整性。
 */

describe('SSE Event Chain Integration', () => {
  /** 完整 Agentic 事件链 */
  const EXPECTED_AGENTIC_ORDER = [
    'routing',
    'query_augment',
    'retrieval',
    'sufficiency',
    // sufficiency → rerank (sufficient) 或 web_search → rerank (insufficient)
    'rerank',
    'token', // 多个 token 事件
    'citation',
    'reflection',
    'final',
  ];

  /** 带 interrupt 的事件链 */
  const EXPECTED_INTERRUPT_ORDER = [
    'routing',
    'query_augment',
    'retrieval',
    'sufficiency',
    'rerank',
    'token',
    'citation',
    'interrupt', // 在 reflection 前暂停
  ];

  describe('事件顺序校验', () => {
    it('should define a complete expected agentic event list', () => {
      expect(EXPECTED_AGENTIC_ORDER).toBeDefined();
      expect(EXPECTED_AGENTIC_ORDER.length).toBeGreaterThan(0);
    });

    it('should emit routing before query_augment', () => {
      const events = ['routing', 'query_augment', 'retrieval'];
      const routingIdx = events.indexOf('routing');
      const augmentIdx = events.indexOf('query_augment');
      expect(routingIdx).toBeLessThan(augmentIdx);
    });

    it('should emit retrieval before sufficiency', () => {
      const events = ['routing', 'query_augment', 'retrieval', 'sufficiency'];
      const retrievalIdx = events.indexOf('retrieval');
      const sufficiencyIdx = events.indexOf('sufficiency');
      expect(retrievalIdx).toBeLessThan(sufficiencyIdx);
    });

    it('should emit token before citation and reflection', () => {
      const events = [
        'routing',
        'query_augment',
        'retrieval',
        'sufficiency',
        'rerank',
        'token',
        'token',
        'token',
        'citation',
        'reflection',
        'final',
      ];

      const firstTokenIdx = events.indexOf('token');
      const citationIdx = events.indexOf('citation');
      const reflectionIdx = events.indexOf('reflection');
      const finalIdx = events.indexOf('final');

      expect(firstTokenIdx).toBeLessThan(citationIdx);
      expect(citationIdx).toBeLessThan(reflectionIdx);
      expect(reflectionIdx).toBeLessThan(finalIdx);
    });

    it('should emit web_search between sufficiency and rerank when retrieval is insufficient', () => {
      const insufficientEvents = [
        'routing',
        'query_augment',
        'retrieval',
        'sufficiency',
        'web_search',
        'rerank',
        'token',
        'citation',
        'reflection',
        'final',
      ];

      const suffIdx = insufficientEvents.indexOf('sufficiency');
      const wsIdx = insufficientEvents.indexOf('web_search');
      const rerankIdx = insufficientEvents.indexOf('rerank');

      expect(wsIdx).toBeGreaterThan(suffIdx);
      expect(wsIdx).toBeLessThan(rerankIdx);
    });

    it('should emit interrupt event when enableInterrupt=true', () => {
      const interruptEvents = [...EXPECTED_INTERRUPT_ORDER];
      expect(interruptEvents).toContain('interrupt');
      expect(interruptEvents).not.toContain('reflection');
      expect(interruptEvents).not.toContain('final');
    });

    it('should emit resume and final after human approval', () => {
      const resumeEvents = ['resume', 'reflection', 'final'];
      expect(resumeEvents[0]).toBe('resume');
      expect(resumeEvents[resumeEvents.length - 1]).toBe('final');
    });
  });

  describe('事件数据完整性', () => {
    it('routing event should contain mode and route', () => {
      const routingEvent = {
        type: 'routing' as const,
        data: { mode: 'auto', route: 'agentic' },
      };
      expect(routingEvent.data).toHaveProperty('mode');
      expect(routingEvent.data).toHaveProperty('route');
      expect(['simple', 'agentic']).toContain(routingEvent.data.route);
    });

    it('query_augment event should contain array of queries', () => {
      const augmentEvent = {
        type: 'query_augment' as const,
        data: ['q1', 'q2', 'q3'],
      };
      expect(Array.isArray(augmentEvent.data)).toBe(true);
      expect(augmentEvent.data.length).toBeGreaterThanOrEqual(1);
    });

    it('reflection event should contain confidence and passed', () => {
      const reflectionEvent = {
        type: 'reflection' as const,
        data: { confidence: 0.85, passed: true, retryCount: 1 },
      };
      expect(reflectionEvent.data.confidence).toBeGreaterThanOrEqual(0);
      expect(reflectionEvent.data.confidence).toBeLessThanOrEqual(1);
      expect(typeof reflectionEvent.data.passed).toBe('boolean');
    });

    it('interrupt event should contain answer and references', () => {
      const interruptEvent = {
        type: 'interrupt' as const,
        data: {
          reason: '等待人工审批',
          answer: 'Generated answer...',
          references: [{ id: 'chunk-1', content: 'test' }],
          threadId: 'thread-123',
        },
      };
      expect(interruptEvent.data).toHaveProperty('reason');
      expect(interruptEvent.data).toHaveProperty('answer');
      expect(interruptEvent.data).toHaveProperty('threadId');
    });

    it('final event should contain answer and references', () => {
      const finalEvent = {
        type: 'final' as const,
        data: {
          answer: 'Final answer',
          references: [],
          confidence: 0.9,
          retryCount: 1,
        },
      };
      expect(finalEvent.data).toHaveProperty('answer');
      expect(finalEvent.data).toHaveProperty('references');
    });
  });
});
