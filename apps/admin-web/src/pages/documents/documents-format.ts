import dayjs from 'dayjs';

export function restoreLegacyFilenameEncoding(filename: string): string {
  const characters = Array.from(filename);
  const codePoints = characters.map((character) => character.codePointAt(0) ?? 0);
  if (codePoints.some((codePoint) => codePoint > 0xff)) return filename;

  const latin1ByteCount = codePoints.filter((codePoint) => codePoint >= 0x80).length;
  if (latin1ByteCount < 3) return filename;

  try {
    const bytes = Uint8Array.from(codePoints);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const hanCount = (value: string) => value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    return hanCount(decoded) > hanCount(filename) ? decoded : filename;
  } catch {
    return filename;
  }
}

export function formatDocumentDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : '—';
}
