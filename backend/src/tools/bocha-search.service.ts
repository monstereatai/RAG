import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BochaSearchResult {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  siteName?: string;
  datePublished?: string;
}

interface BochaWebPage {
  name?: unknown;
  url?: unknown;
  snippet?: unknown;
  summary?: unknown;
  siteName?: unknown;
  datePublished?: unknown;
}

interface BochaSearchResponse {
  data?: {
    webPages?: {
      value?: BochaWebPage[];
    };
  };
}

@Injectable()
export class BochaSearchService {
  private readonly logger = new Logger(BochaSearchService.name);
  private readonly endpoint = 'https://api.bochaai.com/v1/web-search';

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.config.get<string>('bocha.apiKey'));
  }

  async search(query: string, count = 5): Promise<BochaSearchResult[]> {
    const apiKey = this.config.get<string>('bocha.apiKey');
    if (!apiKey) {
      this.logger.warn('BOCHA_API_KEY is empty, skip web_search');
      return [];
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        // 常识类问题不应被近一年时间窗过滤，交由博查根据查询词选择范围。
        freshness: 'noLimit',
        summary: true,
        count,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Bocha web_search failed: ${response.status} ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as BochaSearchResponse;
    // 博查的成功响应使用 data.webPages.value；此前少读取了一层 data，导致有效结果被当成空数组。
    const pages = payload.data?.webPages?.value ?? [];
    return pages
      .map((page): BochaSearchResult | null => {
        const url = this.toString(page.url);
        if (!url) return null;

        return {
          title: this.toString(page.name) || url,
          url,
          snippet: this.toString(page.snippet),
          summary: this.toString(page.summary),
          siteName: this.toString(page.siteName) || undefined,
          datePublished: this.toString(page.datePublished) || undefined,
        };
      })
      .filter((item): item is BochaSearchResult => item !== null);
  }

  private toString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
