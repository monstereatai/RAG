import './tracing';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // 全局验证管道
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  // 全局拦截器和过滤器
  app.useGlobalInterceptors(
    new TransformInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // 配置Swagger
  const config = new DocumentBuilder()
    .setTitle('NestJS Enterprise API')
    .setDescription('企业级NestJS服务端API文档')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', '认证相关接口')
    .addTag('users', '用户管理接口')
    .addTag('orders', '订单管理接口')
    .addTag('payments', '支付管理接口')
    .addTag('notifications', '通知管理接口')
    .addTag('admin', '管理功能接口')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3001;
  
  /**
   * [微服务治理 - gRPC 开启引导]
   * 
   * 若要同时作为 gRPC 宿主运行，安装依赖后解除以下注释即可：
   * 
   * app.connectMicroservice({
   *   transport: require('@nestjs/microservices').Transport.GRPC,
   *   options: {
   *     package: 'grpc.user',
   *     protoPath: require('path').join(__dirname, 'modules/grpc/proto/user.proto'),
   *     url: '0.0.0.0:50051',
   *   },
   * });
   * 
   * await app.startAllMicroservices();
   */

  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api`);
}

bootstrap();