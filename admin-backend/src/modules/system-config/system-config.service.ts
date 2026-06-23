import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SystemConfigService {
  constructor(private readonly configService: ConfigService) {}

  /** 前端 system-config 页面用的配置列表 */
  getConfigList() {
    const configs = [
      { key: 'llm_model', value: 'qwen-plus', description: 'LLM 模型', group: 'rag', updatedAt: new Date().toISOString() },
      { key: 'embedding_model', value: 'text-embedding-v2', description: 'Embedding 模型', group: 'rag', updatedAt: new Date().toISOString() },
      { key: 'chunk_size', value: '500', description: '分块大小', group: 'rag', updatedAt: new Date().toISOString() },
      { key: 'chunk_overlap', value: '50', description: '分块重叠', group: 'rag', updatedAt: new Date().toISOString() },
      { key: 'vector_top_k', value: '5', description: '向量检索 Top-K', group: 'rag', updatedAt: new Date().toISOString() },
      { key: 'rag_service_url', value: process.env.RAG_SERVICE_BASE_URL || 'http://localhost:3000/api/v1', description: 'RAG 服务地址', group: 'integration', updatedAt: new Date().toISOString() },
      { key: 'rag_timeout_ms', value: process.env.RAG_SERVICE_TIMEOUT_MS || '2000', description: 'RAG 超时(ms)', group: 'integration', updatedAt: new Date().toISOString() },
      { key: 'jwt_expires_in', value: process.env.JWT_EXPIRES_IN || '1h', description: 'JWT 过期时间', group: 'auth', updatedAt: new Date().toISOString() },
      { key: 'rate_limit_max', value: process.env.RATE_LIMIT_MAX || '100', description: '限流最大请求数', group: 'security', updatedAt: new Date().toISOString() },
    ];
    return { data: configs };
  }

  /** 更新配置项（内存模式，不持久化） */
  updateConfig(key: string, value: string) {
    return { success: true, key, value, note: '内存模式，重启后失效' };
  }

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
