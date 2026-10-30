/** 扫描件 PDF 的每页 OCR 最多尝试次数。 */
export const OCR_MAX_ATTEMPTS_PER_PAGE = 2;

/** 图片 alt 批量生成的并发上限（视觉模型调用温和节流）。 */
export const IMAGE_ALT_CONCURRENCY = 2;

/** 简易并发池：最多 limit 个任务同时执行，结果顺序与输入一致 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/* ── 内置渲染器：pdfjs-dist（ESM）+ @napi-rs/canvas ── */
/**
 * 动态 import ESM-only 依赖的惯用法。
 *
 * tsc 以 CJS 输出时会把静态 `await import('x')` 降级成 require，
 * 导致 ESM-only 包（pdfjs-dist）加载失败，因此用 Function 构造器
 * 绕过编译期改写；playwright 动态渲染与 PDF 页面渲染共用此 helper。
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
export const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as <T>(specifier: string) => Promise<T>;

/** 读取正整数环境变量，非法值回退默认值（阈值/并发等均可按需调参） */
export function envPositiveNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
