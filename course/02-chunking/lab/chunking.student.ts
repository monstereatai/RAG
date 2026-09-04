import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

/**
 * Lab 02 · 学员实战填空版
 * 派生自 backend/src/modules/document/chunking.util.ts（生产代码）
 * 三处 TODO：
 *   ① normalizeTables  —— 表格语义化（表头捕获 + key=value 序列化）
 *   ② collectSections  —— 标题栈算法（headingPath 弹栈/压栈）
 *   ③ splitTableBlock  —— 长表格按完整行分组 + 表头复用
 * 运行方式见 course/02-chunking/lab/README.md
 */

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

  constructor(chunkSize = 500, chunkOverlap = 50) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
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

      // ============================================================
      // TODO(①) 表格语义化：把 markdown 表格行翻译成自包含文本（约 15 行）
      //
      // a. 分隔行（cells 每一项都匹配 /^:?-{3,}:?$/）是语法噪音
      //    → 直接 continue 跳过，不输出任何内容
      // b. 第一个数据行是表头
      //    → 记入 tableHeader，并输出 `表格列：列1 / 列2`
      // c. 后续数据行
      //    → 用表头做 key 序列化为 `表格行：列1=值1；列2=值2`
      //      列数超出表头时用 `列${index + 1}` 兜底
      // ============================================================
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
      const split = await splitter.splitText(regularBlocks.join('\n\n'));
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

    // ============================================================
    // TODO(③) 按完整行分组：超预算就开新 chunk，且新 chunk 必须复用表头
    //
    // 遍历 rows，逐行处理（约 8 行）：
    // a. 先计算"若把 row 追加进 current"的总长度（join('\n').length）
    // b. 仅当 current 已含数据行（current.length > baseLines.length）
    //    且追加后超 contentBudget：
    //    把 current join('\n') 推入 chunks，
    //    并重开 current = [...baseLines, row]（表头复用！）
    // c. 否则 current.push(row) 继续攒
    // ============================================================
    // TODO(③) 循环结束后：最后一组 current（仍需判断已含数据行）也要推入 chunks

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
        // ============================================================
        // TODO(②) 标题栈算法：遇到标题时切换章节（约 12 行）
        //
        // a. 先 pushCurrent() 把上一节收尾
        // b. level = heading[1].length（# 的个数）
        // c. 维护标题栈 headingPath：
        //    先 slice(0, level - 1) 弹掉更深层级，
        //    再把 heading[2].trim() 压到 headingPath[level - 1] 位置
        //    （任何时刻 headingPath 都是从 H1 到当前标题的完整路径）
        // d. 开启新 current 节：
        //    headingPath 需 filter(Boolean) 拷贝（防后续标题污染前面的节），
        //    lines 以当前行为首行，start/end 基于 offset 计算
        //    （每行处理完后 offset += line.length + 1，+1 是换行符）
        // e. continue 进入下一行
        // ============================================================
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
