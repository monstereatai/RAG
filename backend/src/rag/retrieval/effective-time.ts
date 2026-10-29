import type {
  EffectiveTimeRange,
  RetrievalScope,
  RetrievedChunk,
} from '../evidence/retrieval.types';

/** Interpret explicit calendar periods only; never infer ACL or business scope. */
export function parseEffectiveTime(
  query: string,
): EffectiveTimeRange | undefined {
  if (
    !/(有效|生效|规则|规定|政策|制度|版本|历史|当时|valid|effective|policy|version)/i.test(
      query,
    )
  )
    return undefined;
  const chinese = query.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月?\s*(?:[—–~～至到－-]\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月?)?/,
  );
  const iso = query.match(
    /(\d{4})-(\d{2})(?:-(\d{2}))?(?:\s*(\/|至|到|—|–|~|～)\s*(\d{4})-(\d{2})(?:-(\d{2}))?)?/,
  );
  const date = (year: number, month: number, day = 1): Date | undefined => {
    const value = new Date(Date.UTC(year, month - 1, day));
    return value.getUTCFullYear() === year &&
      value.getUTCMonth() === month - 1 &&
      value.getUTCDate() === day
      ? value
      : undefined;
  };
  let from: Date | undefined;
  let to: Date | undefined;
  if (chinese) {
    from = date(Number(chinese[1]), Number(chinese[2]));
    to = date(
      Number(chinese[3] ?? chinese[1]),
      Number(chinese[4] ?? chinese[2]),
    );
    if (to) to.setUTCMonth(to.getUTCMonth() + 1);
  } else if (iso) {
    from = date(Number(iso[1]), Number(iso[2]), Number(iso[3] ?? 1));
    to = date(
      Number(iso[5] ?? iso[1]),
      Number(iso[6] ?? iso[2]),
      Number(iso[7] ?? iso[3] ?? 1),
    );
    if (to && iso[4] !== '/') {
      if (iso[7] || (!iso[5] && iso[3])) to.setUTCDate(to.getUTCDate() + 1);
      else to.setUTCMonth(to.getUTCMonth() + 1);
    }
  }
  if (!from || !to || from >= to) return undefined;
  return { from: from.toISOString(), to: to.toISOString() };
}

export function scopeForEffectiveTime(
  query: string,
  scope?: RetrievalScope,
): RetrievalScope | undefined {
  const effectiveTime = scope?.effectiveTime ?? parseEffectiveTime(query);
  return effectiveTime
    ? {
        ...scope,
        effectiveTime,
        includeDeprecated: scope?.includeDeprecated ?? true,
      }
    : scope;
}

export function isEffectiveDuring(
  chunk: Partial<RetrievedChunk>,
  range?: EffectiveTimeRange,
): boolean {
  if (
    chunk.lifecycleStatus === 'draft' ||
    chunk.lifecycleStatus === 'archived'
  ) {
    return false;
  }
  if (!range) {
    if (chunk.lifecycleStatus === 'expired') return false;
    const now = Date.now();
    return (
      !(chunk.effectiveAt && Date.parse(chunk.effectiveAt) > now) &&
      !(chunk.expiredAt && Date.parse(chunk.expiredAt) <= now)
    );
  }
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const start = chunk.effectiveAt ? Date.parse(chunk.effectiveAt) : -Infinity;
  const end = chunk.expiredAt ? Date.parse(chunk.expiredAt) : Infinity;
  return (
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    from < to &&
    start < end &&
    start < to &&
    end > from
  );
}
