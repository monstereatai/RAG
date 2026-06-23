import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SystemConfigService {
  constructor(private readonly configService: ConfigService) {}

  getOverview() {
    return {
      service: 'admin-backend',
      runtime: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: Number(process.env.PORT || 3001),
      },
      integrations: {
        database: {
          enabled: process.env.ENABLE_DATABASE === 'true',
          hostConfigured: Boolean(process.env.DB_HOST),
        },
        redis: {
          enabled: process.env.ENABLE_REDIS === 'true',
          hostConfigured: Boolean(process.env.REDIS_HOST),
        },
        rabbitmq: {
          enabled: process.env.ENABLE_RABBITMQ === 'true',
          urlConfigured: Boolean(process.env.RABBITMQ_URL),
        },
        ragService: {
          baseUrl: this.configService.get<string>('RAG_SERVICE_BASE_URL') ||
            process.env.RAG_SERVICE_BASE_URL ||
            'http://localhost:3000/api/v1',
          timeoutMs: Number(process.env.RAG_SERVICE_TIMEOUT_MS || 2000),
          contract: 'http-api',
          sharedPackage: false,
        },
      },
      redaction: {
        secretsReturned: false,
        note: '该接口只返回配置状态，不返回密钥、密码或 token。',
      },
    };
  }
}
