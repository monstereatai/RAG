/** Normalize a user or rewritten query without changing its meaning. */
export function normalizePromptQuery(query: string): string {
  return query.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function normalizeQuery(query: string): string {
  return normalizePromptQuery(query).toLowerCase();
}
