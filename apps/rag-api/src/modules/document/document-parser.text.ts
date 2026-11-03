import { BadRequestException } from '@nestjs/common';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndownService.use(gfm);

export function jsonToMarkdown(input: string): string {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new BadRequestException('invalid json document');
  }

  if (Array.isArray(value) && value.every(isPlainRecord)) {
    return recordsToMarkdownTable(value);
  }

  if (isPlainRecord(value)) {
    return objectToMarkdown(value);
  }

  return [
    '# JSON Document',
    '',
    '```json',
    JSON.stringify(value, null, 2),
    '```',
  ]
    .join('\n')
    .trim();
}

export function csvToMarkdown(input: string): string {
  const rows = parseCsv(input)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));

  if (rows.length === 0) {
    return '';
  }

  const [header, ...body] = rows;
  const normalizedHeader = header.map(
    (cell, index) => cell || `Column ${index + 1}`,
  );
  const tableRows: string[][] =
    body.length > 0
      ? body
      : [Array.from({ length: normalizedHeader.length }, () => '')];
  return [
    '# CSV Document',
    '',
    markdownTable(normalizedHeader, tableRows),
  ].join('\n');
}

export function htmlToText(input: string): string {
  const metadata = extractHtmlMetadata(input);
  const cleaned = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(nav|header|footer|aside|form|button)[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    );
  const main =
    cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    cleaned;

  const body = turndownService
    .turndown(main)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const cleanTitle = metadata.title;
  return [cleanTitle ? `# ${cleanTitle}` : '', body]
    .filter(Boolean)
    .join('\n\n');
}

export function extractHtmlMetadata(input: string): {
  title?: string;
  description?: string;
} {
  const title =
    input.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    input.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    '';
  const description =
    input.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    input.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    '';
  return {
    title: cleanInlineHtml(title),
    description: cleanInlineHtml(description),
  };
}

export function withUrlMetadata(params: {
  body: string;
  sourceUrl: string;
  finalUrl: string;
  fetchedAt: string;
  contentType: string;
  extractionMode: 'static' | 'dynamic';
  title?: string;
  description?: string;
}): string {
  return [
    params.title ? `# ${params.title}` : '',
    params.description ? `> ${params.description}` : '',
    '## Source',
    '',
    `- URL: ${params.sourceUrl}`,
    `- Final URL: ${params.finalUrl}`,
    `- Fetched At: ${params.fetchedAt}`,
    `- Content-Type: ${params.contentType || 'unknown'}`,
    `- Extraction Mode: ${params.extractionMode}`,
    '',
    params.body,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function cleanInlineHtml(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

export function objectToMarkdown(record: Record<string, unknown>): string {
  return [
    '# JSON Document',
    '',
    ...Object.entries(record).map(([key, value]) => {
      const rendered =
        typeof value === 'object' && value !== null
          ? `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
          : ` ${stringifyCell(value)}`;
      return `## ${key}\n${rendered}`;
    }),
  ].join('\n\n');
}

export function recordsToMarkdownTable(
  records: Record<string, unknown>[],
): string {
  const headers = Array.from(
    records.reduce((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const rows = records.map((record) =>
    headers.map((header) => stringifyCell(record[header])),
  );
  return ['# JSON Document', '', markdownTable(headers, rows)].join('\n');
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const normalizedRows = rows.map((row) =>
    headers.map((_, index) => escapeMarkdownCell(row[index] ?? '')),
  );
  return [
    `| ${headers.map(escapeMarkdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...normalizedRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return value.description ?? '';
  }
  return '';
}

export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function decodeXmlEntities(input: string): string {
  return decodeHtmlEntities(input).replace(/&apos;/g, "'");
}
