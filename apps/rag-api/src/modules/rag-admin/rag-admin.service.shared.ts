export function imageAssetContentType(key: string): string | null {
  const extension = key.split('.').at(-1)?.toLowerCase();
  const contentTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };
  return extension ? (contentTypes[extension] ?? null) : null;
}
