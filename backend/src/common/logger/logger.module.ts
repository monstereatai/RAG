import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * 结构化日志模块（pino + nestjs-pino）
 * - JSON 格式输出
 * - 自动记录请求 method/url/statusCode/响应时间
 * - 开发环境使用 pino-pretty 美化输出
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          transport:
            process.env.NODE_ENV !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
          serializers: {
            req: (req: IncomingMessage) => ({
              method: req.method,
              url: req.url,
            }),
            res: (res: ServerResponse) => ({
              statusCode: res.statusCode,
            }),
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url === '/api/health',
          },
        },
      }),
    }),
  ],
})
export class LoggerModule {}
