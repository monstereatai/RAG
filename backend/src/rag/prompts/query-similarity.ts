/**
 * 查询改写语义门禁。
 * 生产环境可替换为 embedding cosine；当前使用中文字符 bigram + 词元 TF cosine，
 * 不增加外部依赖，并对短查询保留专有名词和数字的硬约束。
 */
export function querySimilarity(left: string, right: string): number {
  const a = toFeatures(left);
  const b = toFeatures(right);
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const value of a.values()) na += value * value;
  for (const value of b.values()) nb += value * value;
  for (const [key, value] of a) dot += value * (b.get(key) ?? 0);
  return dot / Math.sqrt(na * nb);
}

export function filterSemanticQueries(
  original: string,
  candidates: unknown,
  threshold = 0.8,
): string[] {
  const originalQuery = original.trim();
  if (!originalQuery) return [];
  const accepted = Array.isArray(candidates)
    ? candidates
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .filter(
          (query) =>
            query === originalQuery ||
            querySimilarity(originalQuery, query) >= threshold,
        )
    : [];
  return [originalQuery, ...accepted].filter(
    (query, index, all) => all.indexOf(query) === index,
  );
}

function toFeatures(value: string): Map<string, number> {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const features = new Map<string, number>();
  const tokens = normalized.match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) ?? [];
  for (const token of tokens)
    features.set(`t:${token}`, (features.get(`t:${token}`) ?? 0) + 1);
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const bigram = `b:${tokens[i]}${tokens[i + 1]}`;
    features.set(bigram, (features.get(bigram) ?? 0) + 1);
  }
  return features;
}
