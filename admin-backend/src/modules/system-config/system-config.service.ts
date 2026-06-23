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
          schemaManagedHere: true,
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
      modules: {
        auth: { status: 'available', storage: 'database-or-memory' },
        users: { status: 'available', storage: 'database-or-memory' },
        roles: { status: 'available', storage: 'database-or-memory' },
        permissions: { status: 'available', storage: 'database-or-memory' },
        accountSecurity: { status: 'partial', storage: 'memory', blockers: ['forgot-password', 'mfa-persistence'] },
        menus: { status: 'partial', storage: 'static', blockers: ['menu-persistence', 'drag-sort'] },
        dashboard: { status: 'available', dependsOn: ['ragService', 'auditLogs'] },
        documents: { status: 'available', dependsOn: ['rag-backend:/rag/admin/documents'] },
        ragOps: { status: 'available', dependsOn: ['rag-backend:/rag/admin/*'] },
        searchOps: { status: 'available', dependsOn: ['rag-backend:/rag/admin/search/*'] },
        qaOps: { status: 'available', dependsOn: ['rag-backend:/rag/admin/qa/*'] },
        graphOps: { status: 'available', dependsOn: ['rag-backend:/rag/admin/graph/*'] },
        auditLogs: {
          status: process.env.ENABLE_DATABASE === 'true' ? 'partial' : 'disabled',
          dependsOn: ['audit_logs table'],
        },
        notifications: { status: 'available', storage: 'database-or-memory' },
        systemConfig: { status: 'available', secretsReturned: false },
      },
      blockers: [
        {
          key: 'database-schema',
          message: '通知持久化、菜单权限、登录安全策略等需要数据库 schema，需主人确认后才能改。',
        },
      ],
      redaction: {
        secretsReturned: false,
        note: '该接口只返回配置状态，不返回密钥、密码或 token。',
      },
    };
  }
}
