import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private requestCounts = new Map<string, number>();
  private requestDurations = new Map<string, number>();

  /**
   * 记录 HTTP 请求指标
   * @param method HTTP 方法
   * @param route 路由模式 (e.g. /users/:id)
   * @param statusCode 状态码
   * @param durationMs 耗时(毫秒)
   */
  recordRequest(method: string, route: string, statusCode: number, durationMs: number) {
    const key = `method="${method}",route="${route}",status_code="${statusCode}"`;
    this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);
    this.requestDurations.set(key, (this.requestDurations.get(key) || 0) + durationMs / 1000);
  }

  /**
   * 生成 Prometheus 格式指标文本
   */
  getMetrics(): string {
    const lines: string[] = [];

    // 1. 内存指标
    const mem = process.memoryUsage();
    lines.push('# HELP node_memory_usage_bytes Node.js memory usage in bytes');
    lines.push('# TYPE node_memory_usage_bytes gauge');
    lines.push(`node_memory_usage_bytes{type="rss"} ${mem.rss}`);
    lines.push(`node_memory_usage_bytes{type="heapTotal"} ${mem.heapTotal}`);
    lines.push(`node_memory_usage_bytes{type="heapUsed"} ${mem.heapUsed}`);
    lines.push(`node_memory_usage_bytes{type="external"} ${mem.external}`);
    lines.push('');

    // 1.5 CPU 指标
    const cpu = process.cpuUsage();
    lines.push('# HELP node_cpu_usage_seconds_total Total CPU time spent in seconds');
    lines.push('# TYPE node_cpu_usage_seconds_total counter');
    lines.push(`node_cpu_usage_seconds_total{type="user"} ${(cpu.user / 1000000).toFixed(6)}`);
    lines.push(`node_cpu_usage_seconds_total{type="system"} ${(cpu.system / 1000000).toFixed(6)}`);
    lines.push('');

    // 2. Uptime 指标
    lines.push('# HELP node_uptime_seconds Node.js process uptime in seconds');
    lines.push('# TYPE node_uptime_seconds gauge');
    lines.push(`node_uptime_seconds ${process.uptime()}`);
    lines.push('');

    // 3. HTTP 请求总数
    lines.push('# HELP http_requests_total Total number of HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [labels, count] of this.requestCounts.entries()) {
      lines.push(`http_requests_total{${labels}} ${count}`);
    }
    lines.push('');

    // 4. HTTP 请求总耗时
    lines.push('# HELP http_request_duration_seconds_sum Total duration of HTTP requests in seconds');
    lines.push('# TYPE http_request_duration_seconds_sum counter');
    for (const [labels, sum] of this.requestDurations.entries()) {
      lines.push(`http_request_duration_seconds_sum{${labels}} ${sum.toFixed(6)}`);
    }
    lines.push('');

    // 5. HTTP 请求耗时计数
    lines.push('# HELP http_request_duration_seconds_count Total count of HTTP requests for duration');
    lines.push('# TYPE http_request_duration_seconds_count counter');
    for (const [labels, count] of this.requestCounts.entries()) {
      lines.push(`http_request_duration_seconds_count{${labels}} ${count}`);
    }
    lines.push('');

    return lines.join('\n');
  }
}
