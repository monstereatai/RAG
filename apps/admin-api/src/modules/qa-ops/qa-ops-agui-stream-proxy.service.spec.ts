import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { QaOpsAguiStreamProxyService } from './qa-ops-agui-stream-proxy.service';
import type { RagClientService } from '../rag-client/rag-client.service';

class MockResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writes: Buffer[] = [];
  write = jest.fn((chunk: Buffer) => {
    this.writes.push(Buffer.from(chunk));
    return true;
  });
  end = jest.fn(() => {
    this.writableEnded = true;
    return this;
  });
}

describe('QaOpsAguiStreamProxyService', () => {
  let streamAgui: jest.Mock;
  let service: QaOpsAguiStreamProxyService;

  beforeEach(() => {
    streamAgui = jest.fn();
    service = new QaOpsAguiStreamProxyService({ streamAgui } as unknown as RagClientService);
  });

  it('forwards the request context and copies upstream SSE data', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: RUN_STARTED\n\n'));
        controller.enqueue(new TextEncoder().encode('data: RUN_FINISHED\n\n'));
        controller.close();
      },
    });
    streamAgui.mockResolvedValue({ ok: true, status: 200, body });
    const response = new MockResponse();
    const query = {
      query: '问题',
      mode: 'auto' as const,
      model: 'qwen' as const,
      userId: 'admin:stable-id',
      threadId: 'thread-1',
      pluginKeys: ['qa'],
      attachmentIds: ['attachment-1'],
    };

    await service.proxy(
      query,
      response as unknown as Response,
      '00-trace-span-01',
      'request-1',
    );

    expect(streamAgui).toHaveBeenCalledWith(
      query,
      expect.any(AbortSignal),
      '00-trace-span-01',
      'request-1',
    );
    expect(Buffer.concat(response.writes).toString()).toBe(
      'data: RUN_STARTED\n\ndata: RUN_FINISHED\n\n',
    );
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('keeps the proxy fallback event contract when RAG returns an error', async () => {
    streamAgui.mockResolvedValue({ ok: false, status: 401, body: null });
    const response = new MockResponse();

    await service.proxy(
      { query: '问题', mode: 'auto', userId: 'admin:stable-id' },
      response as unknown as Response,
    );

    const payload = Buffer.concat(response.writes).toString();
    expect(payload).toContain('"type":"RUN_STARTED"');
    expect(payload).toContain('"mode":"proxy-fallback"');
    expect(payload).toContain('"type":"TEXT_MESSAGE_CONTENT"');
    expect(payload).toContain('内部服务 token');
    expect(payload).toContain('"type":"RUN_FINISHED"');
    expect(payload).toContain('"route":"proxy-fallback"');
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('aborts the upstream request and cancels its reader after client disconnect', async () => {
    let cancelCalled = false;
    let signal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: RUN_STARTED\n\n'));
      },
      cancel() {
        cancelCalled = true;
      },
    });
    streamAgui.mockImplementation(
      async (_query: unknown, requestSignal: AbortSignal) => {
        signal = requestSignal;
        return { ok: true, status: 200, body };
      },
    );
    const response = new MockResponse();
    response.write.mockImplementation((chunk: Buffer) => {
      response.writes.push(Buffer.from(chunk));
      response.destroyed = true;
      response.emit('close');
      return true;
    });

    await service.proxy(
      { query: '问题', mode: 'auto', userId: 'admin:stable-id' },
      response as unknown as Response,
    );

    expect(signal?.aborted).toBe(true);
    expect(cancelCalled).toBe(true);
    expect(response.end).not.toHaveBeenCalled();
  });

  it('waits for response drain before reading the next upstream chunk', async () => {
    let releaseDrain: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'));
        controller.enqueue(new TextEncoder().encode('second'));
        controller.close();
      },
    });
    streamAgui.mockResolvedValue({ ok: true, status: 200, body });
    const response = new MockResponse();
    response.write
      .mockImplementationOnce((chunk: Buffer) => {
        response.writes.push(Buffer.from(chunk));
        setImmediate(() => releaseDrain?.());
        return false;
      })
      .mockImplementation((chunk: Buffer) => {
        response.writes.push(Buffer.from(chunk));
        return true;
      });
    const originalOnce = jest.spyOn(response, 'once');
    originalOnce.mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (event === 'drain') releaseDrain = () => listener();
      return response;
    });

    await service.proxy(
      { query: '问题', mode: 'auto', userId: 'admin:stable-id' },
      response as unknown as Response,
    );

    expect(Buffer.concat(response.writes).toString()).toBe('firstsecond');
    expect(response.write).toHaveBeenCalledTimes(2);
    expect(response.end).toHaveBeenCalledTimes(1);
  });
});
