import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { Logger } from 'nestjs-pino';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TencentSpeechProvider } from './providers/speech/tencent-speech.provider';

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

  // gRPC 微服务（可选，通过 GRPC_ENABLED=true 开启）
  const grpcEnabled = process.env.GRPC_ENABLED !== 'false';
  if (grpcEnabled) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        package: 'rag',
        protoPath: join(__dirname, '../modules/grpc/rag.proto'),
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
