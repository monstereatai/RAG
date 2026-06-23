import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { Logger } from '@nestjs/common';

const logger = new Logger('OpenTelemetry');

// 示例 OTLP Exporter 配置
// 在真实的大厂环境中，这里可以是：
// 1. 阿里云 SLS OTLP 接入点
// 2. DataDog Agent 的本地 4318 端口
// 3. Jaeger 的 Collector 地址
const traceExporter = new OTLPTraceExporter({
  // URL to OTLP collector
  // url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  url: 'http://localhost:4318/v1/traces',
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: 'admin-backend',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  }),
  traceExporter,
  instrumentations: [],
});

// 在非测试环境、非强制禁用的情况下启动追踪
if (process.env.NODE_ENV !== 'test' && process.env.ENABLE_TRACING !== 'false') {
  sdk.start();
  logger.log('OpenTelemetry tracing initialized');

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => logger.log('OpenTelemetry tracing terminated'))
      .catch((error) => logger.error('Error terminating OpenTelemetry tracing', error))
      .finally(() => process.exit(0));
  });
}
