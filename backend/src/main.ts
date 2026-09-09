import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { existsSync } from 'node:fs';
import { Logger } from 'nestjs-pino';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TencentSpeechProvider } from './providers/speech/tencent-speech.provider';

const SWAGGER_PATH_LABELS: Record<string, string> = {
  api: 'API',
  rag: 'RAG',
  ops: '运营',
  'ops-api': '运营接口',
  admin: '管理后台',
  'agent-ops': 'Agent 运营',
  workflows: '工作流',
  workflow: '工作流',
  documents: '文档',
  search: '搜索',
  graph: '知识图谱',
  users: '用户',
  auth: '认证',
  health: '健康检查',
};

const hasChinese = (value: unknown) =>
  typeof value === 'string' && /[\u3400-\u9fff]/.test(value);

function addChineseSwaggerDescriptions(document: {
  paths?: Record<string, unknown>;
}) {
  for (const [path, rawPathItem] of Object.entries(document.paths ?? {})) {
    const pathItem = rawPathItem as Record<string, unknown>;
    const pathLabel = path
      .split('/')
      .filter(Boolean)
      .filter((segment) => !segment.startsWith(':'))
      .map((segment) => SWAGGER_PATH_LABELS[segment] ?? segment)
      .join('／') || '接口';
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) continue;
      const operation = rawOperation as Record<string, unknown>;
      const methodLabel = { get: '查询', post: '创建或提交', put: '更新', patch: '部分更新', delete: '删除', options: '获取选项', head: '检查' }[method] ?? '调用';
      const summary = operation.summary;
      const description = operation.description;
      operation.summary = hasChinese(summary) ? summary : `${methodLabel}${pathLabel}接口`;
      operation.description = hasChinese(description)
        ? description
        : `用于${pathLabel}的${methodLabel}接口。请求方式：${method.toUpperCase()}，路径：${path}。`;
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('RAG Backend API')
    .setDescription(
      '企业知识库、RAG 检索、Agent 工作流与 Playway 活动能力接口文档',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addTag('RAG', '知识库检索与问答接口')
    .addTag('Agent Ops', 'Agent 运行与产研工作流接口')
    .addTag('Workflow', '生产工作流与 Playway 接口')
    .addTag('Graph', '知识图谱接口')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  addChineseSwaggerDescriptions(swaggerDocument);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });

  // gRPC 微服务（可选，通过 GRPC_ENABLED=true 开启）
  const grpcEnabled = process.env.GRPC_ENABLED !== 'false';
  if (grpcEnabled) {
    const compiledProtoPath = join(__dirname, 'modules/grpc/rag.proto');
    const protoPath = existsSync(compiledProtoPath)
      ? compiledProtoPath
      : join(process.cwd(), 'src/modules/grpc/rag.proto');
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        package: 'rag',
        protoPath,
        url: process.env.GRPC_URL ?? '0.0.0.0:50051',
        loader: {
          keepCase: true,
          longs: String,
          enums: String,
        },
      },
    });
    await app.startAllMicroservices();
    console.log(
      `gRPC server listening on ${process.env.GRPC_URL ?? '0.0.0.0:50051'}`,
    );
  }

  await app.listen(process.env.PORT ?? 3000);
  attachSpeechWebSocket(
    app.getHttpServer() as Server,
    app.get(TencentSpeechProvider),
  );
}

function attachSpeechWebSocket(
  server: Server,
  speechProvider: TencentSpeechProvider,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on(
    'upgrade',
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!request.url?.startsWith('/api/v1/speech/tts/ws')) {
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    },
  );

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const text = url.searchParams.get('text') ?? '';
    const voiceType = Number(url.searchParams.get('voiceType') ?? '101001');

    if (!text.trim()) {
      ws.send(JSON.stringify({ type: 'error', message: 'text is required' }));
      ws.close();
      return;
    }

    void (async () => {
      let index = 0;
      ws.send(JSON.stringify({ type: 'meta', contentType: 'audio/wav' }));
      try {
        for await (const chunk of speechProvider.synthesizeStream(
          text,
          voiceType,
        )) {
          ws.send(
            JSON.stringify({
              type: 'chunk',
              index,
              encoding: 'base64',
              chunk: chunk.toString('base64'),
            }),
          );
          index += 1;
        }
        ws.send(JSON.stringify({ type: 'done', chunks: index }));
      } catch (err) {
        ws.send(
          JSON.stringify({ type: 'error', message: (err as Error).message }),
        );
      } finally {
        ws.close();
      }
    })();
  });
}
void bootstrap();
