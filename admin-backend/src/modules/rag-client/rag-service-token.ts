import { ConfigService } from '@nestjs/config';

const LOCAL_DEV_RAG_SERVICE_TOKEN = 'local-rag-service-token';

export function resolveRagServiceToken(configService: ConfigService): string {
  const configured =
    configService.get<string>('RAG_SERVICE_TOKEN') ??
    process.env.RAG_SERVICE_TOKEN ??
    '';
  if (configured.trim()) {
    return configured.trim();
  }

  const nodeEnv =
    configService.get<string>('NODE_ENV') ??
    process.env.NODE_ENV ??
    'development';
  if (nodeEnv === 'production') {
    return '';
  }

  return LOCAL_DEV_RAG_SERVICE_TOKEN;
}
