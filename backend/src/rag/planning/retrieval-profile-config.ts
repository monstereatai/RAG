import { BadRequestException } from '@nestjs/common';
import type { RetrievalProfile } from '../retrieval/context-builder';

const RETRIEVAL_CONFIG_LIMITS = {
  candidateDepth: [1, 50],
  finalTopK: [1, 20],
  neighborWindow: [0, 2],
  sameSectionLimit: [0, 4],
  contextCharacterBudget: [1_000, 12_000],
  maxChunksPerDocument: [1, 8],
} as const;

export function sanitizeRetrievalProfileConfig(
  value: unknown,
): Partial<Omit<RetrievalProfile, 'intent'>> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('retrievalConfig must be an object');
  }

  const input = value as Record<string, unknown>;
  const sanitized: Partial<Omit<RetrievalProfile, 'intent'>> = {};
  for (const [key, bounds] of Object.entries(RETRIEVAL_CONFIG_LIMITS)) {
    const candidate = input[key];
    if (candidate === undefined || candidate === null || candidate === '') {
      continue;
    }
    if (
      typeof candidate !== 'number' ||
      !Number.isInteger(candidate) ||
      candidate < bounds[0] ||
      candidate > bounds[1]
    ) {
      throw new BadRequestException(
        `${key} must be an integer between ${bounds[0]} and ${bounds[1]}`,
      );
    }
    sanitized[key as keyof typeof sanitized] = candidate;
  }
  return sanitized;
}
