import { Test, TestingModule } from '@nestjs/testing';
import { QaOpsController } from './qa-ops.controller';
import { RagClientService } from '../rag-client/rag-client.service';
import type { Response } from 'express';

describe('QaOpsController — SSE Streaming', () => {
  let controller: QaOpsController;
  let ragClient: jest.Mocked<RagClientService>;
  let mockRes: jest.Mocked<Response>;
  let mockReq: Record<string, any>;

  beforeEach(async () => {
    ragClient = {
      streamAgui: jest.fn(),
      getQaNegativeFeedback: jest.fn(),
      getQaCitationFailures: jest.fn(),
      getQaCostSummary: jest.fn(),
      getRolePresets: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QaOpsController],
      providers: [
        { provide: RagClientService, useValue: ragClient },
      ],
    }).compile();

    controller = module.get<QaOpsController>(QaOpsController);

    mockRes = {
      setHeader: jest.fn().mockReturnThis(),
      flushHeaders: jest.fn(),
      write: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    } as any;
    Object.defineProperty(mockRes, 'writableEnded', { get: () => false });

    mockReq = {
      on: () => undefined,
      user: { userId: 'test-user', sub: 'test-user' },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('query validation', () => {
    it('should return 400 when query is empty', async () => {
      await controller.streamAgui('', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'query is required' });
      expect(mockRes.setHeader).not.toHaveBeenCalled();
    });

    it('should return 400 when query is whitespace', async () => {
      await controller.streamAgui('   ', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should set SSE headers for valid query', async () => {
      const mockReadable = createMockReadable(['data: {"type":"RUN_FINISHED","runId":"1"}\n\n']);
      ragClient.streamAgui.mockResolvedValue({ ok: true, body: mockReadable } as any);

      await controller.streamAgui('你好', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    });
  });

  describe('role presets', () => {
    it('should proxy the RAG role catalog', async () => {
      ragClient.getRolePresets.mockResolvedValue({
        available: true,
        status: 200,
        data: {
          defaultRolePresetId: 'business-owner',
          roles: [{ id: 'business-owner', name: '业务负责人' }],
        },
      } as any);

      const result = await controller.getRolePresets();

      expect(ragClient.getRolePresets).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        data: {
          defaultRolePresetId: 'business-owner',
          roles: [{ id: 'business-owner', name: '业务负责人' }],
        },
      });
    });

    it('should pass rolePresetId to the AG-UI upstream', async () => {
      const mockReadable = createMockReadable([
        'data: {"type":"RUN_FINISHED","runId":"abc"}\n\n',
      ]);
      ragClient.streamAgui.mockResolvedValue({
        ok: true,
        body: mockReadable,
      } as any);

      await controller.streamAgui(
        '梳理需求',
        'auto',
        'qwen',
        undefined,
        mockReq as any,
        mockRes,
        'product-manager',
      );

      expect(ragClient.streamAgui).toHaveBeenCalledWith(
        expect.objectContaining({ rolePresetId: 'product-manager' }),
        expect.any(AbortSignal),
      );
    });
  });

  describe('upstream 401', () => {
    it('should write friendly fallback on upstream 401', async () => {
      ragClient.streamAgui.mockResolvedValue({
        ok: false,
        status: 401,
        body: null,
      } as any);

      await controller.streamAgui('test', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      expect(mockRes.write).toHaveBeenCalled();
      expect(mockRes.end).toHaveBeenCalled();

      const writeCalls = mockRes.write.mock.calls.map((c) => String(c[0])).join('');
      expect(writeCalls).toContain('RAG_SERVICE_TOKEN');
      expect(writeCalls).toContain('内部服务 token');
      expect(writeCalls).toContain('RUN_FINISHED');
      expect(writeCalls).not.toContain('RUN_ERROR');
    });
  });

  describe('upstream unreachable', () => {
    it('should write friendly fallback on fetch failure', async () => {
      ragClient.streamAgui.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

      await controller.streamAgui('test', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      const writeCalls = mockRes.write.mock.calls.map((c) => String(c[0])).join('');
      expect(writeCalls).toContain('rag-backend');
      expect(writeCalls).toContain('RUN_FINISHED');
      expect(writeCalls).not.toContain('RUN_ERROR');
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should handle upstream 502', async () => {
      ragClient.streamAgui.mockResolvedValue({
        ok: false,
        status: 502,
        body: null,
      } as any);

      await controller.streamAgui('test', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      const writeCalls = mockRes.write.mock.calls.map((c) => String(c[0])).join('');
      expect(writeCalls).toContain('rag service returned 502');
      expect(writeCalls).toContain('RUN_FINISHED');
    });
  });

  describe('normal streaming', () => {
    it('should pipe upstream SSE events to response', async () => {
      const chunks = [
        'data: {"type":"RUN_STARTED","runId":"abc","data":{"input":{"mode":"simple"}}}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","runId":"abc","data":{"delta":"你好"}}\n\n',
        'data: {"type":"RUN_FINISHED","runId":"abc","data":{}}\n\n',
      ];
      const mockReadable = createMockReadable(chunks);
      ragClient.streamAgui.mockResolvedValue({ ok: true, body: mockReadable } as any);

      await controller.streamAgui('你好', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      const writeCalls = mockRes.write.mock.calls.map((c) => String(c[0])).join('');
      expect(writeCalls).toContain('RUN_STARTED');
      expect(writeCalls).toContain('TEXT_MESSAGE_CONTENT');
      expect(writeCalls).toContain('RUN_FINISHED');
      expect(writeCalls).toContain('你好');
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should handle two consecutive identical questions', async () => {
      const mockReadable = createMockReadable([
        'data: {"type":"RUN_FINISHED","runId":"abc"}\n\n',
      ]);

      ragClient.streamAgui.mockResolvedValue({ ok: true, body: mockReadable } as any);

      // First call
      await controller.streamAgui('测试', 'simple', 'qwen', undefined, mockReq as any, mockRes);
      expect(mockRes.end).toHaveBeenCalledTimes(1);

      // Reset mocks to simulate clean second request
      mockRes.end.mockClear();
      mockRes.write.mockClear();
      (mockRes as any)._ended = false;

      // Second call
      await controller.streamAgui('测试', 'simple', 'qwen', undefined, mockReq as any, mockRes);
      expect(mockRes.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('mid-stream disconnection', () => {
    it('should abort upstream when client disconnects', async () => {
      let abortSignal: AbortSignal | undefined;
      let onCloseHandler: (() => void) | undefined;

      mockReq.on = (event: string, handler: any) => {
        if (event === 'close') onCloseHandler = handler;
      };

      ragClient.streamAgui.mockImplementation(
        async (_input: any, signal: AbortSignal) => {
          abortSignal = signal;
          onCloseHandler?.();
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ok: false, status: 499, body: null } as any;
        },
      );

      await controller.streamAgui('test', 'simple', 'qwen', undefined, mockReq as any, mockRes);

      expect(abortSignal?.aborted).toBe(true);
      expect(mockRes.end).toHaveBeenCalled();
    });
  });
});

/** Helper: create a ReadableStream from string chunks */
function createMockReadable(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}
