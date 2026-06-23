import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface TraceSpan {
  id: string;
  parentId?: string;
  traceId: string;
  timestamp: number;
  duration: number;
  name: string;
  service: string;
  tags?: Record<string, any>;
  logs?: Array<{ timestamp: number; fields: Record<string, any> }>;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentId?: string;
}

@Injectable()
export class TracingService {
  private logger = new Logger(TracingService.name);
  private activeSpans: Map<string, TraceSpan> = new Map();
  private traces: Map<string, TraceSpan[]> = new Map();
  private readonly serviceName = 'nestjs-enterprise';

  // 生成trace ID
  generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // 生成span ID
  generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  // 开始一个span
  startSpan(name: string, traceContext?: TraceContext, tags?: Record<string, any>): TraceContext {
    const traceId = traceContext?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const parentId = traceContext?.spanId;

    const span: TraceSpan = {
      id: spanId,
      parentId,
      traceId,
      timestamp: Date.now(),
      duration: 0,
      name,
      service: this.serviceName,
      tags,
    };

    this.activeSpans.set(spanId, span);
    this.logger.log(`Started span: ${name} (${spanId})`);

    return {
      traceId,
      spanId,
      parentId,
    };
  }

  // 结束一个span
  endSpan(spanId: string, tags?: Record<string, any>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      this.logger.warn(`Span ${spanId} not found`);
      return;
    }

    span.duration = Date.now() - span.timestamp;
    span.tags = { ...span.tags, ...tags };

    // 记录日志
    if (span.logs) {
      span.logs.push({
        timestamp: Date.now(),
        fields: { status: 'completed', duration: span.duration },
      });
    }

    // 保存到traces
    if (!this.traces.has(span.traceId)) {
      this.traces.set(span.traceId, []);
    }
    this.traces.get(span.traceId)!.push(span);

    this.activeSpans.delete(spanId);
    this.logger.log(`Ended span: ${span.name} (${spanId}) - Duration: ${span.duration}ms`);
  }

  // 获取当前活跃的span
  getActiveSpan(spanId: string): TraceSpan | undefined {
    return this.activeSpans.get(spanId);
  }

  // 获取完整的trace
  getTrace(traceId: string): TraceSpan[] {
    return this.traces.get(traceId) || [];
  }

  // 获取所有traces
  getAllTraces(): Map<string, TraceSpan[]> {
    return new Map(this.traces);
  }

  // 记录span日志
  log(spanId: string, message: string, fields?: Record<string, any>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      this.logger.warn(`Span ${spanId} not found for logging`);
      return;
    }

    if (!span.logs) {
      span.logs = [];
    }

    span.logs.push({
      timestamp: Date.now(),
      fields: { message, ...fields },
    });

    this.logger.log(`[${span.name}] ${message}`, fields);
  }

  // 添加span标签
  setTag(spanId: string, key: string, value: any): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return;
    }

    span.tags = span.tags || {};
    span.tags[key] = value;
  }

  // 创建错误日志
  error(spanId: string, error: Error, fields?: Record<string, any>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      this.logger.error(`Span ${spanId} not found for error logging`, error.stack);
      return;
    }

    if (!span.logs) {
      span.logs = [];
    }

    span.logs.push({
      timestamp: Date.now(),
      fields: {
        error: error.message,
        stack: error.stack,
        ...fields,
      },
    });

    if (process.env.NODE_ENV !== 'test') {
      this.logger.error(`[${span.name}] Error: ${error.message}`, error.stack);
    }
  }

  // 获取性能统计
  getPerformanceStats(): {
    totalTraces: number;
    averageSpanDuration: number;
    slowestTrace: number;
    errorRate: number;
  } {
    let totalSpans = 0;
    let totalDuration = 0;
    let slowestTrace = 0;
    let errorCount = 0;

    for (const traceSpans of this.traces.values()) {
      for (const span of traceSpans) {
        totalSpans++;
        totalDuration += span.duration;
        slowestTrace = Math.max(slowestTrace, span.duration);

        // 统计错误
        if (span.logs) {
          for (const log of span.logs) {
            if (log.fields.error) {
              errorCount++;
            }
          }
        }
      }
    }

    const totalTraces = this.traces.size;
    const averageSpanDuration = totalSpans > 0 ? totalDuration / totalSpans : 0;
    const totalRequests = totalSpans;
    const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

    return {
      totalTraces,
      averageSpanDuration: Math.round(averageSpanDuration),
      slowestTrace,
      errorRate: Math.round(errorRate * 100) / 100,
    };
  }

  // 清理旧的traces
  cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [traceId, spans] of this.traces) {
      const oldestSpan = spans.reduce((oldest, current) =>
        current.timestamp < oldest.timestamp ? current : oldest, spans[0]
      );

      if (now - oldestSpan.timestamp > maxAge) {
        toDelete.push(traceId);
      }
    }

    for (const traceId of toDelete) {
      this.traces.delete(traceId);
      this.logger.log(`Cleaned up old trace: ${traceId}`);
    }
  }

  // 获取当前活跃span数量
  getActiveSpanCount(): number {
    return this.activeSpans.size;
  }
}
