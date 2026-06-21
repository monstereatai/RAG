import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

interface Section {
  headingPath: string[];
  lines: string[];
  start: number;
  end: number;
  index: number;
}

export interface StructuredChunk {
  content: string;
  chunkIndex: number;
  parentChunkId: string | null;
  headingPath: string[];
  sectionId: string | null;
  clauseId: string | null;
  tableRef: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
}

/**
 * Markdown 文本切分器
 * 使用 RecursiveCharacterTextSplitter，按 Markdown 结构优先切分
 */
export class MarkdownChunker {
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(chunkSize = 500, chunkOverlap = 50) {
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ', ''],
    });
  }

  async split(text: string): Promise<string[]> {
    const chunks = await this.splitStructured(text);
    return chunks.map((chunk) => chunk.content);
  }

  async splitStructured(text: string): Promise<StructuredChunk[]> {
    const normalized = this.normalizeTables(text.trim());
    if (!normalized) {
      return [];
    }
    const sections = this.collectSections(normalized);
    const out: StructuredChunk[] = [];

    for (const section of sections) {
      const body = this.renderSection(section);
      if (!body) continue;

      const sectionChunks = await this.splitter.splitText(body);
      const parentChunkId =
        section.headingPath.length > 0 ? `section-${section.index}` : null;
      for (const content of sectionChunks) {
        out.push({
          content,
          chunkIndex: out.length,
          parentChunkId,
          headingPath: section.headingPath,
          sectionId: parentChunkId,
          clauseId: this.extractClauseId(content),
          tableRef: content.includes('表格行：')
            ? section.headingPath.join(' > ') || 'table'
            : null,
          sourceStart: section.start,
          sourceEnd: section.end,
        });
      }
    }

    return out;
  }

  private normalizeTables(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let tableHeader: string[] | null = null;

    for (const line of lines) {
      const cells = this.parseMarkdownTableRow(line);
      if (!cells) {
        tableHeader = null;
        out.push(line);
        continue;
      }

      const isSeparator = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isSeparator) {
        continue;
      }

      if (!tableHeader) {
        tableHeader = cells;
        out.push(`表格列：${cells.join(' / ')}`);
        continue;
      }

      const rowText = cells
        .map(
          (cell, index) =>
            `${tableHeader?.[index] ?? `列${index + 1}`}=${cell}`,
        )
        .join('；');
      out.push(`表格行：${rowText}`);
    }

    return out.join('\n');
  }

  private parseMarkdownTableRow(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.includes('|')) {
      return null;
    }
    const cells = trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
    return cells.length >= 2 ? cells : null;
  }

  private renderSection(section: Section): string {
    const body = section.lines.join('\n').trim();
    if (!body) return '';

    const prefix =
      section.headingPath.length > 0
        ? `章节路径：${section.headingPath.join(' > ')}\n`
        : '';
    return `${prefix}${body}`;
  }

  private collectSections(text: string): Section[] {
    const sections: Section[] = [];
    let headingPath: string[] = [];
    let current: Section = {
      headingPath: [],
      lines: [],
      start: 0,
      end: 0,
      index: 0,
    };
    let offset = 0;
    let sectionIndex = 0;

    const pushCurrent = () => {
      if (current.lines.some((line) => line.trim().length > 0)) {
        current.index = sectionIndex;
        sections.push(current);
        sectionIndex += 1;
      }
    };

    for (const line of text.split('\n')) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (heading) {
        pushCurrent();
        const level = heading[1].length;
        headingPath = headingPath.slice(0, level - 1);
        headingPath[level - 1] = heading[2].trim();
        current = {
          headingPath: headingPath.filter(Boolean),
          lines: [line],
          start: offset,
          end: offset + line.length,
          index: sectionIndex,
        };
        offset += line.length + 1;
        continue;
      }

      const clause =
        /^((?:第[一二三四五六七八九十百千0-9]+[章节条款])|(?:\d+(?:\.\d+)*[、.]))\s*(.+)$/.exec(
          line.trim(),
        );
      if (clause && current.headingPath.length > 0) {
        current.lines.push(`条款编号：${clause[1]}`);
      }

      current.lines.push(line);
      current.end = offset + line.length;
      offset += line.length + 1;
    }

    pushCurrent();
    return sections.length > 0
      ? sections
      : [
          {
            headingPath: [],
            lines: [text],
            start: 0,
            end: text.length,
            index: 0,
          },
        ];
  }

  private extractClauseId(content: string): string | null {
    const match = /条款编号：([^\n]+)/.exec(content);
    return match?.[1]?.trim() || null;
  }
}
