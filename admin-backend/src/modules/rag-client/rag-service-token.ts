import { ConfigService } from '@nestjs/config';

const LOCAL_DEV_RAG_SERVICE_TOKEN = 'local-rag-service-token';
const MISSING_PRODUCTION_TOKEN_MESSAGE =
  'RAG_SERVICE_TOKEN is required when NODE_ENV=production';

export function resolveRagServiceToken(configService: ConfigService): string {
  const configured =
    configService.get<string>('RAG_SERVICE_TOKEN') ??
    process.env.RAG_SERVICE_TOKEN ??
    '';
  if (configured.trim()) {
    return configured.trim();
  }

  const nodeEnv =
    configService.get<string>('nodeEnv') ??
    configService.get<string>('NODE_ENV') ??
    process.env.NODE_ENV ??
    'development';
  if (nodeEnv === 'production') {
    throw new Error(MISSING_PRODUCTION_TOKEN_MESSAGE);
  }

  return LOCAL_DEV_RAG_SERVICE_TOKEN;
}
