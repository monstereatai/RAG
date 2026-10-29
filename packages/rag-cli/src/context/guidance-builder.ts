export interface CodingGuidance {
  assumptions: string[];
  constraints: string[];
  likelyFiles: string[];
  validationCommands: string[];
}

export function buildGuidance(input: {
  task: string;
  paths?: string[];
  includeRoadmap?: boolean;
}): CodingGuidance {
  const likelyFiles = [...(input.paths ?? [])];
  if (input.includeRoadmap) {
    likelyFiles.push('ROADMAP.md');
  }

  return {
    assumptions: [
      'CLI only calls RAG backend APIs and does not access databases, vector stores, Redis, Neo4j, or .env directly.',
      'Knowledge snippets are evidence, not automatic code changes.',
    ],
    constraints: [
      'Do not print tokens, passwords, or secrets.',
      'Do not modify .env, CI/CD, database schema, migrations, or production deployment configuration.',
      'Return insufficient_context instead of fabricating unsupported conclusions.',
    ],
    likelyFiles: unique(likelyFiles),
    validationCommands: ['pnpm run build', 'pnpm test'],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
