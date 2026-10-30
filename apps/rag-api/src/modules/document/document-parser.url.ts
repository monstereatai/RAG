import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  jsonToMarkdown,
  csvToMarkdown,
  htmlToText,
  extractHtmlMetadata,
  withUrlMetadata,
} from './document-parser.text';
import { dynamicImport } from './document-parser.shared';
import type {
  UrlExtractionResult,
  PlaywrightModule,
} from './document-parser.types';

export async function extractUrlText(url: string): Promise<string> {
  const result = await extractUrlContent(url);
  return result.content;
}

export async function extractUrlContent(
  url: string,
): Promise<UrlExtractionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('valid url is required');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException('only http and https urls are supported');
  }
  await assertSafeExternalUrl(parsed);

  const dynamicEnabled = process.env.URL_EXTRACT_DYNAMIC_ENABLED === 'true';
  if (dynamicEnabled) {
    try {
      const rendered = await renderDynamicUrl(parsed.toString());
      return buildHtmlUrlExtraction({
        html: rendered.html,
        sourceUrl: url,
        finalUrl: rendered.finalUrl,
        contentType: 'text/html; rendered=playwright',
        extractionMode: 'dynamic',
      });
    } catch (err) {
      if (process.env.URL_EXTRACT_DYNAMIC_REQUIRED === 'true') {
        throw new BadRequestException(
          `dynamic url rendering failed: ${(err as Error).message}`,
        );
      }
      const fallback = await extractStaticUrlContent(parsed, url);
      return {
        ...fallback,
        renderError: (err as Error).message,
      };
    }
  }

  return extractStaticUrlContent(parsed, url);
}

export async function extractStaticUrlContent(
  parsed: URL,
  sourceUrl: string,
): Promise<UrlExtractionResult> {
  const { response, finalUrl } = await fetchSafeExternalUrl(parsed);
  if (!response.ok) {
    throw new BadRequestException(
      `failed to fetch url: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 5 * 1024 * 1024) {
    throw new BadRequestException('url content is too large');
  }
  const text = await response.text();
  const snapshot = Buffer.from(text, 'utf-8');
  if (snapshot.length > 5 * 1024 * 1024) {
    throw new BadRequestException('url content is too large');
  }

  await assertSafeExternalUrl(new URL(response.url || finalUrl));
  const fetchedAt = new Date().toISOString();
  if (contentType.includes('application/json')) {
    return {
      content: withUrlMetadata({
        body: jsonToMarkdown(text),
        sourceUrl,
        finalUrl,
        fetchedAt,
        contentType,
        extractionMode: 'static',
      }),
      finalUrl,
      contentType,
      fetchedAt,
      snapshot,
      extractionMode: 'static',
    };
  }
  if (contentType.includes('text/csv')) {
    return {
      content: withUrlMetadata({
        body: csvToMarkdown(text),
        sourceUrl,
        finalUrl,
        fetchedAt,
        contentType,
        extractionMode: 'static',
      }),
      finalUrl,
      contentType,
      fetchedAt,
      snapshot,
      extractionMode: 'static',
    };
  }
  if (contentType.includes('text/html')) {
    return buildHtmlUrlExtraction({
      html: text,
      sourceUrl,
      finalUrl,
      contentType,
      extractionMode: 'static',
    });
  }
  return {
    content: withUrlMetadata({
      body: text,
      sourceUrl,
      finalUrl,
      fetchedAt,
      contentType,
      extractionMode: 'static',
    }),
    finalUrl,
    contentType,
    fetchedAt,
    snapshot,
    extractionMode: 'static',
  };
}

export function buildHtmlUrlExtraction(params: {
  html: string;
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  extractionMode: 'static' | 'dynamic';
}): UrlExtractionResult {
  const snapshot = Buffer.from(params.html, 'utf-8');
  if (snapshot.length > 5 * 1024 * 1024) {
    throw new BadRequestException('url content is too large');
  }
  const fetchedAt = new Date().toISOString();
  const extracted = htmlToText(params.html);
  const metadata = extractHtmlMetadata(params.html);
  return {
    content: withUrlMetadata({
      body: extracted,
      sourceUrl: params.sourceUrl,
      finalUrl: params.finalUrl,
      fetchedAt,
      contentType: params.contentType,
      title: metadata.title,
      description: metadata.description,
      extractionMode: params.extractionMode,
    }),
    title: metadata.title,
    description: metadata.description,
    finalUrl: params.finalUrl,
    contentType: params.contentType,
    fetchedAt,
    snapshot,
    extractionMode: params.extractionMode,
  };
}

export async function renderDynamicUrl(url: string): Promise<{
  html: string;
  finalUrl: string;
}> {
  await assertSafeExternalUrl(new URL(url));
  const playwright = await dynamicImport<PlaywrightModule>('playwright');
  const browser = await playwright.chromium.launch({
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route('**/*', async (route) => {
      try {
        const requestUrl = new URL(route.request().url());
        // 子资源和跳转也必须解析 DNS 并拒绝私网目标，不能只检查 URL 中的主机名。
        await assertSafeExternalUrl(requestUrl);
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });
    await page.goto(url, {
      waitUntil:
        (process.env.URL_EXTRACT_DYNAMIC_WAIT_UNTIL as
          | 'load'
          | 'domcontentloaded'
          | 'networkidle') ?? 'networkidle',
      timeout: Number(process.env.URL_EXTRACT_DYNAMIC_TIMEOUT_MS ?? 15_000),
    });
    const settleMs = Number(process.env.URL_EXTRACT_DYNAMIC_SETTLE_MS ?? 500);
    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }
    const finalUrl = page.url();
    await assertSafeExternalUrl(new URL(finalUrl));
    return { html: await page.content(), finalUrl };
  } finally {
    await browser.close();
  }
}

export const MAX_EXTERNAL_REDIRECTS = 3;

/**
 * 仅允许访问公网 HTTP(S) 地址，避免文档导入接口被用作 SSRF 探针。
 * DNS 解析失败也按拒绝处理，避免在无法确认目标地址时继续请求。
 */
export async function assertSafeExternalUrl(parsed: URL): Promise<void> {
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException('only http and https urls are supported');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    hostname.endsWith('.test')
  ) {
    throw new BadRequestException('private or local urls are not allowed');
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException('unable to resolve external url');
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedIp(address))
  ) {
    throw new BadRequestException('private or local urls are not allowed');
  }
}

export function isBlockedIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIp(normalized.slice('::ffff:'.length));
  }
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && b >= 18 && b <= 19) ||
      a >= 224
    );
  }
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

export async function fetchSafeExternalUrl(
  parsed: URL,
): Promise<{ response: Response; finalUrl: string }> {
  let current = new URL(parsed);
  for (
    let redirectCount = 0;
    redirectCount <= MAX_EXTERNAL_REDIRECTS;
    redirectCount += 1
  ) {
    await assertSafeExternalUrl(current);
    const response = await fetch(current, {
      headers: {
        accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8',
        'user-agent': 'RAG-KnowledgeBase/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: current.toString() };
    }
    const location = response.headers.get('location');
    if (!location) return { response, finalUrl: current.toString() };
    if (redirectCount === MAX_EXTERNAL_REDIRECTS) {
      throw new BadRequestException('too many url redirects');
    }
    await response.body?.cancel();
    current = new URL(location, current);
  }
  throw new BadRequestException('too many url redirects');
}
