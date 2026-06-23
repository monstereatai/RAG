import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

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
}
void bootstrap();
