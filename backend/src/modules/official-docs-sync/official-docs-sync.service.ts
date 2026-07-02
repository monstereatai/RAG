import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { KarpathyObsidianIngestService } from '../document/karpathy-obsidian-ingest.service';

interface OfficialDocsSource {
  id: string;
  title: string;
  seeds: string[];
  pathPrefixes: string[];
}

interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  hash: string;
  changed: boolean;
  changeType: 'new' | 'modified';
}

interface SyncState {
  updatedAt: string;
  pages: Record<
    string,
    {
      sourceId: string;
      title: string;
      hash: string;
      syncedAt: string;
    }
  >;
}

const DEFAULT_SOURCES: OfficialDocsSource[] = [
  {
    id: 'react',
    title: 'React Official Docs',
    seeds: ['https://react.dev/learn', 'https://react.dev/reference/react'],
    pathPrefixes: ['/learn', '/reference'],
  },
  {
    id: 'vue',
    title: 'Vue Official Docs',
    seeds: ['https://vuejs.org/guide/introduction', 'https://vuejs.org/api/'],
    pathPrefixes: ['/guide', '/api'],
  },
  {
    id: 'javascript',
    title: 'JavaScript MDN Docs',
    seeds: [
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference',
    ],
    pathPrefixes: ['/en-US/docs/Web/JavaScript'],
  },
  {
    id: 'nestjs',
    title: 'NestJS Official Docs',
    seeds: [
      'https://docs.nestjs.com/',
      'https://docs.nestjs.com/controllers',
      'https://docs.nestjs.com/providers',
    ],
    pathPrefixes: ['/'],
  },
];

@Injectable()
export class OfficialDocsSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfficialDocsSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly karpathyObsidianIngest: KarpathyObsidianIngestService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('officialDocsSync.enabled')) {
      this.logger.log('Official docs nightly sync disabled');
      return;
    }

    if (this.config.get<boolean>('officialDocsSync.runOnStart')) {
      setTimeout(() => void this.syncAll('startup'), 5_000).unref?.();
    }
    this.scheduleNextRun();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async syncAll(reason = 'scheduled'): Promise<{
    sourceCount: number;
    changedPageCount: number;
    uploadedDocCount: number;
  }> {
    if (this.running) {
      this.logger.warn(
        'Official docs sync skipped because previous run is active',
      );
      return {
        sourceCount: DEFAULT_SOURCES.length,
        changedPageCount: 0,
        uploadedDocCount: 0,
      };
    }

    this.running = true;
    const startedAt = Date.now();
    let changedPageCount = 0;
    let uploadedDocCount = 0;

    try {
      const state = await this.loadState();
      const syncedAt = new Date().toISOString();
      this.logger.log(`Official docs sync started, reason=${reason}`);

      for (const source of DEFAULT_SOURCES) {
        const changedPages = await this.collectChangedPages(source, state);
        changedPageCount += changedPages.length;
        if (changedPages.length === 0) {
          this.logger.log(`No official docs changes: ${source.id}`);
          continue;
        }

        const markdown = this.renderMarkdown(source, changedPages, syncedAt);
        const filename = `official-docs-${source.id}-${syncedAt.slice(0, 10)}.md`;
        await this.karpathyObsidianIngest.ingestText({
          title: `${source.title} Nightly Changes`,
          filename,
          content: markdown,
          userId:
            this.config.get<string>('officialDocsSync.userId') ??
            'system-official-docs',
          sourceType: 'official-docs',
          contentType: 'text/markdown',
          originalBuffer: Buffer.from(markdown, 'utf8'),
        });
        uploadedDocCount += 1;

        for (const page of changedPages) {
          state.pages[page.url] = {
            sourceId: source.id,
            title: page.title,
            hash: page.hash,
            syncedAt,
          };
        }
        state.updatedAt = syncedAt;
        await this.saveState(state);
        this.logger.log(
          `Official docs changes uploaded: ${source.id}, pages=${changedPages.length}`,
        );
      }

      this.logger.log(
        `Official docs sync completed in ${Date.now() - startedAt}ms, changedPages=${changedPageCount}, uploadedDocs=${uploadedDocCount}`,
      );
      return {
        sourceCount: DEFAULT_SOURCES.length,
        changedPageCount,
        uploadedDocCount,
      };
    } catch (error) {
      this.logger.warn(
        `Official docs sync failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    } finally {
      this.running = false;
      if (this.config.get<boolean>('officialDocsSync.enabled')) {
        this.scheduleNextRun();
      }
    }
  }

  private scheduleNextRun(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const nextRunAt = this.nextRunAt();
    const delayMs = Math.max(1_000, nextRunAt.getTime() - Date.now());
    this.timer = setTimeout(() => void this.syncAll('scheduled'), delayMs);
    this.timer.unref?.();
    this.logger.log(
      `Official docs next sync scheduled at ${nextRunAt.toISOString()}`,
    );
  }

  private nextRunAt(): Date {
    const hour = this.config.get<number>('officialDocsSync.hour') ?? 1;
    const now = new Date();
    const next = new Date(now);
    next.setHours(Math.min(23, Math.max(0, hour)), 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  private async collectChangedPages(
    source: OfficialDocsSource,
    state: SyncState,
  ): Promise<PageSnapshot[]> {
    const maxPages =
      this.config.get<number>('officialDocsSync.maxPagesPerSource') ?? 12;
    const visited = new Set<string>();
    const queue = source.seeds.map((url) => this.normalizeUrl(url));
    const pages: PageSnapshot[] = [];

    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);

      try {
        const html = await this.fetchHtml(url);
        for (const link of this.extractLinks(html, url, source)) {
          if (!visited.has(link) && !queue.includes(link)) {
            queue.push(link);
          }
        }

        const title = this.extractTitle(html) || url;
        const text = this.extractText(html);
        if (text.length < 200) {
          this.logger.warn(
            `Official docs page skipped: text too short, url=${url}`,
          );
          continue;
        }

        const hash = this.hash(text);
        const previous = state.pages[url];
        if (previous?.hash === hash) continue;

        pages.push({
          url,
          title,
          text,
          hash,
          changed: true,
          changeType: previous ? 'modified' : 'new',
        });
      } catch (error) {
        this.logger.warn(
          `Official docs page failed: url=${url}, error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return pages;
  }

  private async fetchHtml(url: string): Promise<string> {
    const timeoutMs =
      this.config.get<number>('officialDocsSync.timeoutMs') ?? 15_000;
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'RAG-OfficialDocsSync/1.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      throw new Error(`unsupported content-type ${contentType}`);
    }
    return response.text();
  }

  private extractLinks(
    html: string,
    baseUrl: string,
    source: OfficialDocsSource,
  ): string[] {
    const base = new URL(baseUrl);
    const links = new Set<string>();
    const pattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html))) {
      try {
        const candidate = this.normalizeUrl(new URL(match[1], base).toString());
        const parsed = new URL(candidate);
        if (parsed.origin !== base.origin) continue;
        if (
          !source.pathPrefixes.some((prefix) =>
            parsed.pathname.startsWith(prefix),
          )
        ) {
          continue;
        }
        links.add(candidate);
      } catch {
        // ignore invalid href
      }
    }

    return [...links];
  }

  private extractTitle(html: string): string | null {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
    const title = h1 ?? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    return title ? this.decodeEntities(this.stripTags(title)).trim() : null;
  }

  private extractText(html: string): string {
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? html;
    const withoutNoise = main
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
      .replace(
        /<(h[1-6]|p|li|pre|blockquote|tr|section|article)\b[^>]*>/gi,
        '\n',
      )
      .replace(/<br\s*\/?>/gi, '\n');

    return this.decodeEntities(this.stripTags(withoutNoise))
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private stripTags(value: string): string {
    return value.replace(/<[^>]+>/g, ' ');
  }

  private decodeEntities(value: string): string {
    return value
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'");
  }

  private renderMarkdown(
    source: OfficialDocsSource,
    pages: PageSnapshot[],
    syncedAt: string,
  ): string {
    const body = pages
      .map(
        (page) => `## ${page.title}

- source: official
- sourceName: ${source.title}
- sourceId: ${source.id}
- url: ${page.url}
- changeType: ${page.changeType}
- contentHash: ${page.hash}
- syncedAt: ${syncedAt}

${page.text}`,
      )
      .join('\n\n---\n\n');

    return `# ${source.title} Nightly Changes

source: official-docs-sync
official: true
sourceAuthority: official
syncedAt: ${syncedAt}
changedPages: ${pages.length}

${body}
`;
  }

  private normalizeUrl(url: string): string {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  }

  private hash(text: string): string {
    return createHash('sha256')
      .update(text.replace(/\s+/g, ' ').trim())
      .digest('hex');
  }

  private async loadState(): Promise<SyncState> {
    const filePath = this.stateFilePath();
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as SyncState;
    } catch {
      return { updatedAt: new Date(0).toISOString(), pages: {} };
    }
  }

  private async saveState(state: SyncState): Promise<void> {
    const filePath = this.stateFilePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  private stateFilePath(): string {
    const uploadDir =
      this.config.get<string>('workspace.uploadDir') ??
      resolve(process.cwd(), '../workspace/uploads');
    return resolve(dirname(uploadDir), 'official-docs-sync-state.json');
  }
}
