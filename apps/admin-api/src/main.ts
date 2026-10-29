import './tracing';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

import { Logger } from 'nestjs-pino';

const SWAGGER_PATH_LABELS: Record<string, string> = {
  api: 'API',
  admin: '管理后台',
  'agent-ops': 'Agent 运营',
  users: '用户',
  auth: '认证',
  documents: '文档',
  search: '搜索',
  graph: '知识图谱',
  system: '系统',
  qa: '问答',
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
    .setTitle('RAG Admin Backend API')
    .setDescription('RAG 管理后台、权限、运营与 Agent 管理接口文档')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addTag('auth', '认证相关接口')
    .addTag('users', '用户管理接口')
    .addTag('orders', '订单管理接口')
    .addTag('payments', '支付管理接口')
    .addTag('notifications', '通知管理接口')
    .addTag('admin', '管理功能接口')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  addChineseSwaggerDescriptions(document);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });

  // 全局 API 前缀，与前端 proxy 对齐
  app.setGlobalPrefix('api', {
    exclude: ['health'],
  });

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
  console.log(`📚 API Documentation: http://localhost:${port}/docs`);
}

bootstrap();
