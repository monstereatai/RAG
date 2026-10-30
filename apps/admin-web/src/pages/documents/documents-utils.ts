export const repairMojibake = (value?: string | null): string => {
  if (!value) return '';
  if (!/[ÃÂâðåæçèéêëìíîïñòóôõö÷øùúûüýþÿ]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(
      value,
      (character) => character.charCodeAt(0) & 0xff,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
};

export const unwrapResponseData = (value: any) => {
  let payload = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!payload || typeof payload !== 'object' || !('data' in payload)) break;
    payload = payload.data;
  }
  return payload;
};

export function normalizeList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.departments)) return raw.departments;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.data?.items)) return raw.data.items;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}
