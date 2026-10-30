import type { AnswerMedia, EventTraceItem } from './qa-ops-types';
import type { GeneratedArtifact } from './service';

export const ROLE_PRESET_STORAGE_KEY = 'qa_ops_role_preset';

export const toAnswerMedia = (value: unknown): AnswerMedia[] => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item, index): AnswerMedia | null => {
      if (typeof item === 'string') {
        return {
          id: `image-${index}-${item}`,
          type: 'image',
          url: item,
        };
      }
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const url =
        typeof record.url === 'string'
          ? record.url
          : typeof record.src === 'string'
            ? record.src
            : '';
      if (!url) return null;
      const type = typeof record.type === 'string' ? record.type : 'image';
      const mimeType =
        typeof record.mimeType === 'string' ? record.mimeType : '';
      if (type !== 'image' && !mimeType.startsWith('image/')) return null;
      return {
        id: typeof record.id === 'string' ? record.id : `image-${index}-${url}`,
        type: 'image',
        url,
        alt: typeof record.alt === 'string' ? record.alt : undefined,
        title: typeof record.title === 'string' ? record.title : undefined,
      };
    })
    .filter((item): item is AnswerMedia => Boolean(item));
};

export const mergeMedia = (
  current: AnswerMedia[] | undefined,
  next: AnswerMedia[],
) => {
  const merged = [...(current ?? [])];
  const seen = new Set(merged.map((item) => item.id || item.url));
  for (const item of next) {
    const key = item.id || item.url;
    if (!seen.has(key)) {
      merged.push(item);
      seen.add(key);
    }
  }
  return merged;
};

export const toAnswerArtifacts = (value: unknown): GeneratedArtifact[] => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter((item): item is GeneratedArtifact => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record.id === 'string' &&
      typeof record.title === 'string' &&
      typeof record.filename === 'string' &&
      ['markdown', 'word', 'excel', 'architecture', 'image'].includes(
        String(record.kind),
      ) &&
      ['queued', 'generating', 'ready', 'failed'].includes(
        String(record.status),
      )
    );
  });
};

export const mergeArtifacts = (
  current: GeneratedArtifact[] | undefined,
  next: GeneratedArtifact[],
) => {
  const byId = new Map((current ?? []).map((item) => [item.id, item]));
  next.forEach((item) => {
    byId.set(item.id, item);
  });
  return [...byId.values()];
};

export const appendEventTrace = (
  events: EventTraceItem[] | undefined,
  type: string,
) => {
  const next = [...(events ?? [])];
  const last = next[next.length - 1];
  if (last?.type === type) {
    next[next.length - 1] = { ...last, count: last.count + 1 };
    return next;
  }
  next.push({ type, count: 1 });
  return next;
};
