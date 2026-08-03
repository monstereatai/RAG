import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

export interface TraceSnapshot {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  startedAt: string;
  kind?: 'http' | 'agent_node';
  alert?: 'span_limit';
}

interface StartedTrace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startedAt: Date;
  startNs: bigint;
}

@Injectable()
export class TracingService {
  private readonly spans: TraceSnapshot[] = [];
  private readonly maxSpans = 200;

  start(incomingTraceparent?: string): StartedTrace {
    const parent = this.parseTraceparent(incomingTraceparent);
    return {
      traceId: parent?.traceId ?? randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      parentSpanId: parent?.spanId,
      startedAt: new Date(),
      startNs: process.hrtime.bigint(),
    };
  }

  finish(
    trace: StartedTrace,
    method: string,
    route: string,
    status: number,
  ): TraceSnapshot {
    const durationMs = Number(process.hrtime.bigint() - trace.startNs) / 1e6;
    const snapshot: TraceSnapshot = {
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      method,
      route,
      status,
      durationMs: Number(durationMs.toFixed(2)),
      startedAt: trace.startedAt.toISOString(),
      kind: 'http',
    };

    this.spans.push(snapshot);
    if (this.spans.length > this.maxSpans) {
      this.spans.splice(0, this.spans.length - this.maxSpans);
    }

    return snapshot;
  }

  recordAgentNode(input: {
    threadId: string;
    node: string;
    status: 'success' | 'error';
    durationMs: number;
    startedAt: Date;
  }): TraceSnapshot {
    const traceId = this.normalizeTraceId(input.threadId);
    const nodeSpanCount = this.spans.filter(
      (span) => span.traceId === traceId && span.kind === 'agent_node',
    ).length;
    const snapshot: TraceSnapshot = {
      traceId,
      spanId: randomBytes(8).toString('hex'),
      method: 'AGENT',
      route: input.node,
      status: input.status === 'success' ? 200 : 500,
      durationMs: Number(input.durationMs.toFixed(2)),
      startedAt: input.startedAt.toISOString(),
      kind: 'agent_node',
      ...(nodeSpanCount + 1 > 15 ? { alert: 'span_limit' as const } : {}),
    };

    this.spans.push(snapshot);
    if (this.spans.length > this.maxSpans) {
      this.spans.splice(0, this.spans.length - this.maxSpans);
    }
    return snapshot;
  }

  toTraceparent(trace: StartedTrace): string {
    return `00-${trace.traceId}-${trace.spanId}-01`;
  }

  recent(limit = 20): TraceSnapshot[] {
    return this.spans.slice(-limit).reverse();
  }

  private parseTraceparent(
    traceparent?: string,
  ): { traceId: string; spanId: string } | null {
    if (!traceparent) return null;

    const match = traceparent.match(
      /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i,
    );
    if (!match) return null;

    return {
      traceId: match[1].toLowerCase(),
      spanId: match[2].toLowerCase(),
    };
  }

  private normalizeTraceId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
  }
}
