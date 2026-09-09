import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

interface Section {
  headingPath: string[];
  lines: string[];
  start: number;
  end: number;
  index: number;
}

type BusinessBlockKind =
  | 'plain'
  | 'code'
  | 'table'
  | 'api'
  | 'test'
  | 'version';

interface BusinessBlock {
  kind: BusinessBlockKind;
  content: string;
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
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly semanticBoundaries: boolean;

  constructor(chunkSize = 500, chunkOverlap = 50, semanticBoundaries = true) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.semanticBoundaries = semanticBoundaries;
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
      const body = this.renderSectionBody(section);
      if (!body) continue;

      const sectionChunks = await this.splitSection(section, body);
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
    let fencedCode = false;

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        fencedCode = !fencedCode;
        tableHeader = null;
        out.push(line);
        continue;
      }
      if (fencedCode) {
        out.push(line);
        continue;
      }

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
    const row = trimmed.replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    const cells: string[] = [];
    let cell = '';

    for (let index = 0; index < row.length; index += 1) {
      const char = row[index];
      if (char === '\\' && row[index + 1] === '|') {
        cell += '|';
        index += 1;
        continue;
      }
      if (char === '|') {
        cells.push(cell.trim());
        cell = '';
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());

    return cells.length >= 2 && cells.some((value) => value.length > 0)
      ? cells
      : null;
  }

  private renderSectionBody(section: Section): string {
    const lines = [...section.lines];
    if (lines.length > 0 && /^(#{1,6})\s+/.test(lines[0].trim())) {
      lines.shift();
    }
    return lines.join('\n').trim();
  }

  private async splitSection(
    section: Section,
    body: string,
  ): Promise<string[]> {
    const prefix =
      section.headingPath.length > 0
        ? `章节路径：${section.headingPath.join(' > ')}\n`
        : '';
    const contentBudget = Math.max(1, this.chunkSize - prefix.length);
    const blocks = this.collectBusinessBlocks(body);
    const chunks: string[] = [];
    let regularBlocks: string[] = [];

    const flushRegularBlocks = async () => {
      if (regularBlocks.length === 0) return;
      const splitter =
        prefix.length === 0
          ? this.splitter
          : new RecursiveCharacterTextSplitter({
              chunkSize: contentBudget,
              chunkOverlap: Math.min(
                this.chunkOverlap,
                Math.max(0, contentBudget - 1),
              ),
              separators: [
                '\n\n',
                '\n',
                '。',
                '！',
                '？',
                '.',
                '!',
                '?',
                ' ',
                '',
              ],
            });
      const regularText = regularBlocks.join('\n\n');
      const split = this.semanticBoundaries
        ? this.splitBySemanticBoundary(regularText, contentBudget)
        : await splitter.splitText(regularText);
      chunks.push(...split.map((content) => `${prefix}${content}`));
      regularBlocks = [];
    };

    for (const block of blocks) {
      const decorated = this.decorateBusinessBlock(block);
      if (block.kind === 'code' || block.kind === 'table') {
        await flushRegularBlocks();
        const protectedChunks =
          block.kind === 'table'
            ? this.splitTableBlock(decorated, contentBudget)
            : [decorated];
        chunks.push(...protectedChunks.map((content) => `${prefix}${content}`));
        continue;
      }
      regularBlocks.push(decorated);
    }

    await flushRegularBlocks();
    return chunks;
  }

  /** 在句子／段落边界动态装箱，重叠只从完整语义单元中选取，避免半句截断。 */
  private splitBySemanticBoundary(text: string, budget: number): string[] {
    const units = text
      .split(/(?<=[。！？.!?])\s+|\n+/u)
      .map((unit) => unit.trim())
      .filter(Boolean);
    if (units.length === 0) return [];
    const chunks: string[] = [];
    let current: string[] = [];
    const flush = () => {
      if (current.length === 0) return;
      chunks.push(current.join(' '));
      const overlap: string[] = [];
      let length = 0;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const nextLength = length + current[index].length + (overlap.length ? 1 : 0);
        if (nextLength > this.chunkOverlap && overlap.length > 0) break;
        overlap.unshift(current[index]);
        length = nextLength;
      }
      current = overlap;
    };
    for (const unit of units) {
      if (unit.length > budget) {
        flush();
        chunks.push(unit);
        continue;
      }
      const candidate = current.length ? `${current.join(' ')} ${unit}` : unit;
      if (current.length > 0 && candidate.length > budget) flush();
      current.push(unit);
    }
    flush();
    return chunks;
  }

  private collectBusinessBlocks(body: string): BusinessBlock[] {
    const blocks: string[] = [];
    let current: string[] = [];
    let fencedCode = false;

    const pushCurrent = () => {
      const content = current.join('\n').trim();
      if (content) blocks.push(content);
      current = [];
    };

    for (const line of body.split('\n')) {
      const fence = /^\s*```/.test(line);
      if (!fencedCode && fence && current.length > 0) {
        pushCurrent();
      }
      current.push(line);
      if (fence) {
        fencedCode = !fencedCode;
        if (!fencedCode) pushCurrent();
        continue;
      }
      if (!fencedCode && line.trim() === '') {
        pushCurrent();
      }
    }
    pushCurrent();

    return blocks.map((content) => ({
      content,
      kind: this.detectBusinessBlockKind(content),
    }));
  }

  private detectBusinessBlockKind(content: string): BusinessBlockKind {
    if (/^\s*```/.test(content)) return 'code';
    if (/^表格列：/m.test(content) || /^表格行：/m.test(content)) {
      return 'table';
    }
    if (
      /(?:测试用例|前置条件|操作步骤|预期结果|验收标准|回归范围)/.test(content)
    ) {
      return 'test';
    }
    if (
      /(?:^|\n)\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+/i.test(content) ||
      /(?:请求参数|响应参数|返回字段|错误码|接口地址|API)/i.test(content)
    ) {
      return 'api';
    }
    if (
      /(?:版本[：:]|生效(?:时间|日期|地区)?[：:]|适用地区[：:]|已废弃|失效时间[：:]|V\d+)/i.test(
        content,
      )
    ) {
      return 'version';
    }
    return 'plain';
  }

  private decorateBusinessBlock(block: BusinessBlock): string {
    const labels: Record<Exclude<BusinessBlockKind, 'plain'>, string> = {
      code: '代码或配置',
      table: '配置表',
      api: '接口契约',
      test: '测试与验收',
      version: '版本与地区规则',
    };
    if (block.kind === 'plain') return block.content;
    return `内容类型：${labels[block.kind]}\n${block.content}`;
  }

  private splitTableBlock(content: string, contentBudget: number): string[] {
    const lines = content.split('\n');
    const label = lines.find((line) => line.startsWith('内容类型：'));
    const header = lines.find((line) => line.startsWith('表格列：'));
    const rows = lines.filter((line) => line.startsWith('表格行：'));
    if (!header || rows.length === 0) return [content];

    const baseLines = [label, header].filter((line): line is string => !!line);
    const chunks: string[] = [];
    let current = [...baseLines];

    for (const row of rows) {
      const candidate = [...current, row].join('\n');
      if (
        current.length > baseLines.length &&
        candidate.length > contentBudget
      ) {
        chunks.push(current.join('\n'));
        current = [...baseLines, row];
      } else {
        current.push(row);
      }
    }
    if (current.length > baseLines.length) chunks.push(current.join('\n'));
    return chunks.length > 0 ? chunks : [content];
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
