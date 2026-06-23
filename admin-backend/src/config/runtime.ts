import * as dotenv from 'dotenv';

export function getRuntimeEnvFilePaths(): string[] {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const files = [`.env.${nodeEnv}`, '.env'];

  if (nodeEnv !== 'development') {
    files.push('.env.development');
  }

  return files;
}

for (const path of getRuntimeEnvFilePaths()) {
  dotenv.config({ path, quiet: true });
}

export function isDatabaseEnabled(): boolean {
  return process.env.ENABLE_DATABASE === 'true';
}
export function isRedisEnabled(): boolean {
  return process.env.ENABLE_REDIS === 'true';
}
