const REQUIRED_IN_PRODUCTION = [
  'JWT_SECRET',
  'RAG_SERVICE_TOKEN',
  'POSTGRES_URL',
  'REDIS_URL',
  'OBJECT_STORAGE_PROVIDER',
] as const;

export function assertRuntimeConfig(): void {
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();
  if (nodeEnv !== 'production') return;

  const errors: string[] = [];
  for (const key of REQUIRED_IN_PRODUCTION) {
    const value = process.env[key]?.trim() ?? '';
    if (value.length === 0) errors.push(`${key} is required in production`);
  }

  const jwtSecret = process.env.JWT_SECRET?.trim() ?? '';
  if (jwtSecret.length > 0 && jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters in production');
  }

  if ((process.env.OBJECT_STORAGE_PROVIDER ?? '').trim() === 'local') {
    errors.push('OBJECT_STORAGE_PROVIDER=local is not allowed in production');
  }

  if ((process.env.AUTH_REQUIRE_EMAIL_VERIFIED ?? 'true') === 'false') {
    errors.push(
      'AUTH_REQUIRE_EMAIL_VERIFIED=false is not allowed in production',
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `invalid production runtime configuration:\n- ${errors.join('\n- ')}`,
    );
  }
}
