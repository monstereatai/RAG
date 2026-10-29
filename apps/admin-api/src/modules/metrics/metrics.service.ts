import { Injectable } from '@nestjs/common';

/**
 * admin-backend 指标服务（手写 Prometheus 文本格式，不依赖 prom-client）
 *
 * 命名规范：
 * - counter 一律 `_total` 结尾；histogram 展开 `_bucket` / `_sum` / `_count`
 * - 时间单位一律 `_seconds`
 * - 统一 `admin_` 前缀，避免与 RAG 后端（rag_*）在同一 Prometheus 实例里重名
 * - label 只保留 method / route / status 这类低基数维度；userId、requestId 等高基数维度禁止写入
 */
const HTTP_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 30,
];

type HttpLabels = { method: string; route: string; status: string };

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();

  /** counter：只累加不减少。 */
  private requestCounts = new Map<string, number>();

  /** histogram：每个 label 组合维护 bucket 计数、总和与样本数。 */
  private readonly requestDurations = new Map<
    string,
    { buckets: number[]; sum: number; count: number }
  >();

  /**
   * 记录一次 HTTP 请求：同时更新 counter 与 histogram。
   * @param durationMs 耗时（毫秒，入口处统一换算为秒）
   */
  recordRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const labels: HttpLabels = {
      method,
      route,
      status: String(statusCode),
    };
    const labelsKey = this.serialize(labels);
    const seconds = durationMs / 1000;

    this.requestCounts.set(labelsKey, (this.requestCounts.get(labelsKey) ?? 0) + 1);

    const histogram =
      this.requestDurations.get(labelsKey) ??
      {
        buckets: HTTP_DURATION_BUCKETS_SECONDS.map(() => 0),
        sum: 0,
        count: 0,
      };
    HTTP_DURATION_BUCKETS_SECONDS.forEach((bound, index) => {
      if (seconds <= bound) histogram.buckets[index] += 1;
    });
    histogram.sum += seconds;
    histogram.count += 1;
    this.requestDurations.set(labelsKey, histogram);
  }

  private serialize(labels: Record<string, string>): string {
    return Object.entries(labels)
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(',');
  }

  /**
   * 生成 Prometheus 文本格式指标。
   * histogram 必须输出 le 递增的 _bucket（含 +Inf），
   * 否则 histogram_quantile() 无法计算 P50/P95/P99。
   */
  getMetrics(): string {
    const lines: string[] = [];

    const mem = process.memoryUsage();
    lines.push('# HELP node_memory_usage_bytes Node.js memory usage in bytes');
    lines.push('# TYPE node_memory_usage_bytes gauge');
    lines.push(`node_memory_usage_bytes{type="rss"} ${mem.rss}`);
    lines.push(`node_memory_usage_bytes{type="heapTotal"} ${mem.heapTotal}`);
    lines.push(`node_memory_usage_bytes{type="heapUsed"} ${mem.heapUsed}`);
    lines.push(`node_memory_usage_bytes{type="external"} ${mem.external}`);
    lines.push('');

    const cpu = process.cpuUsage();
    lines.push('# HELP node_cpu_usage_seconds_total Total CPU time spent in seconds');
    lines.push('# TYPE node_cpu_usage_seconds_total counter');
    lines.push(
      `node_cpu_usage_seconds_total{type="user"} ${(cpu.user / 1_000_000).toFixed(6)}`,
    );
    lines.push(
      `node_cpu_usage_seconds_total{type="system"} ${(cpu.system / 1_000_000).toFixed(6)}`,
    );
    lines.push('');

    lines.push('# HELP node_uptime_seconds Node.js process uptime in seconds');
    lines.push('# TYPE node_uptime_seconds gauge');
    lines.push(`node_uptime_seconds ${process.uptime()}`);
    lines.push('');

    lines.push('# HELP admin_process_start_time_seconds Process start time in seconds');
    lines.push('# TYPE admin_process_start_time_seconds gauge');
    lines.push(`admin_process_start_time_seconds ${this.startedAt / 1000}`);
    lines.push('');

    lines.push('# HELP admin_http_requests_total Total number of HTTP requests');
    lines.push('# TYPE admin_http_requests_total counter');
    for (const [labels, count] of this.requestCounts.entries()) {
      lines.push(`admin_http_requests_total{${labels}} ${count}`);
    }
    lines.push('');

    lines.push(
      '# HELP admin_http_request_duration_seconds HTTP request duration in seconds',
    );
    lines.push('# TYPE admin_http_request_duration_seconds histogram');
    for (const [labels, histogram] of this.requestDurations.entries()) {
      HTTP_DURATION_BUCKETS_SECONDS.forEach((bound, index) => {
        lines.push(
          `admin_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${histogram.buckets[index]}`,
        );
      });
      lines.push(
        `admin_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${histogram.count}`,
      );
      lines.push(
        `admin_http_request_duration_seconds_sum{${labels}} ${histogram.sum.toFixed(6)}`,
      );
      lines.push(
        `admin_http_request_duration_seconds_count{${labels}} ${histogram.count}`,
      );
    }
    lines.push('');

    // 5xx 单独导出一个计数器，便于告警规则直接引用，不必依赖字符串正则匹配
    lines.push(
      '# HELP admin_http_requests_errors_total HTTP requests with 5xx status',
    );
    lines.push('# TYPE admin_http_requests_errors_total counter');
    for (const [labels, count] of this.requestCounts.entries()) {
      if (labels.includes('status="5')) {
        lines.push(`admin_http_requests_errors_total{${labels}} ${count}`);
      }
    }
    lines.push('');

    return lines.join('\n');
  }
}
