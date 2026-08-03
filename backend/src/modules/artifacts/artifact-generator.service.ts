import { Injectable } from '@nestjs/common';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import * as XLSX from 'xlsx';
import type { GeneratedArtifactEntity } from '../../providers/db/entities/generated-artifact.entity';
import { DashScopeImageService } from './dashscope-image.service';

export interface GeneratedFile {
  body: Buffer;
  contentType: string;
  extension: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ArtifactGeneratorService {
  constructor(private readonly imageService: DashScopeImageService) {}

  async generate(artifact: GeneratedArtifactEntity): Promise<GeneratedFile> {
    switch (artifact.kind) {
      case 'markdown':
        return this.markdown(artifact);
      case 'word':
        return this.word(artifact);
      case 'excel':
        return this.excel(artifact);
      case 'architecture':
        return this.architecture(artifact);
      case 'image':
        return this.image(artifact);
    }
  }

  private markdown(artifact: GeneratedArtifactEntity): GeneratedFile {
    const title = artifact.sourceText.trimStart().startsWith('#')
      ? ''
      : `# ${artifact.title}\n\n`;
    return {
      body: Buffer.from(`${title}${artifact.sourceText.trim()}\n`, 'utf8'),
      contentType: 'text/markdown; charset=utf-8',
      extension: 'md',
    };
  }

  private async word(
    artifact: GeneratedArtifactEntity,
  ): Promise<GeneratedFile> {
    const children = artifact.sourceText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) {
          const levels = [
            HeadingLevel.HEADING_1,
            HeadingLevel.HEADING_2,
            HeadingLevel.HEADING_3,
          ];
          return new Paragraph({
            text: heading[2],
            heading: levels[heading[1].length - 1],
          });
        }
        const bullet = /^[-*]\s+(.+)$/.exec(line);
        if (bullet)
          return new Paragraph({ text: bullet[1], bullet: { level: 0 } });
        return new Paragraph({ children: [new TextRun(line)] });
      });
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: artifact.title,
              heading: HeadingLevel.TITLE,
            }),
            ...children,
          ],
        },
      ],
    });
    return {
      body: await Packer.toBuffer(doc),
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    };
  }

  private excel(artifact: GeneratedArtifactEntity): GeneratedFile {
    const workbook = XLSX.utils.book_new();
    const tables = this.extractMarkdownTables(artifact.sourceText);
    if (tables.length) {
      tables.forEach((rows, index) =>
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.aoa_to_sheet(rows),
          `表格${index + 1}`,
        ),
      );
    } else {
      const rows = artifact.sourceText
        .split(/\r?\n/)
        .filter(Boolean)
        .map((content, index) => ({ 序号: index + 1, 内容: content }));
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows),
        '正文',
      );
    }
    return {
      body: XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      metadata: { sheetCount: workbook.SheetNames.length },
    };
  }

  private architecture(artifact: GeneratedArtifactEntity): GeneratedFile {
    const labels = artifact.sourceText
      .split(/\r?\n/)
      .map((line) => line.replace(/^#{1,6}\s+|^[-*]\s+|^\d+[.)]\s+/, '').trim())
      .filter((line) => line.length > 1)
      .slice(0, 12);
    const nodes = labels.length ? labels : [artifact.title];
    const width = 1200;
    const rowHeight = 130;
    const height = Math.max(360, 120 + Math.ceil(nodes.length / 3) * rowHeight);
    const boxes = nodes
      .map((label, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const x = 70 + column * 390;
        const y = 70 + row * rowHeight;
        const nextX = 70 + ((index + 1) % 3) * 390;
        const nextY = 70 + Math.floor((index + 1) / 3) * rowHeight;
        const edge =
          index < nodes.length - 1
            ? `<path d="M ${x + 310} ${y + 40} L ${nextX} ${nextY + 40}" stroke="#87909f" stroke-width="2" fill="none" marker-end="url(#arrow)"/>`
            : '';
        return `${edge}<rect x="${x}" y="${y}" width="310" height="80" rx="6" fill="#f7f9fc" stroke="#1677ff" stroke-width="2"/><text x="${x + 155}" y="${y + 46}" text-anchor="middle" font-size="18" fill="#17233d">${this.escapeXml(label.slice(0, 24))}</text>`;
      })
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#87909f"/></marker></defs><rect width="100%" height="100%" fill="#ffffff"/><text x="60" y="42" font-size="24" font-weight="600" fill="#17233d">${this.escapeXml(artifact.title)}</text>${boxes}</svg>`;
    return {
      body: Buffer.from(svg),
      contentType: 'image/svg+xml; charset=utf-8',
      extension: 'svg',
      metadata: { nodeCount: nodes.length },
    };
  }

  private async image(
    artifact: GeneratedArtifactEntity,
  ): Promise<GeneratedFile> {
    const prompt = artifact.prompt?.trim() || artifact.sourceText.trim();
    return {
      body: await this.imageService.generate(prompt),
      contentType: 'image/png',
      extension: 'png',
      metadata: { model: 'wanx2.1-t2i-turbo' },
    };
  }

  private extractMarkdownTables(text: string): string[][][] {
    const result: string[][][] = [];
    let current: string[][] = [];
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*\|.+\|\s*$/.test(line)) {
        const cells = line
          .trim()
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
          current.push(cells);
      } else if (current.length) {
        result.push(current);
        current = [];
      }
    }
    if (current.length) result.push(current);
    return result;
  }

  private escapeXml(value: string): string {
    return value.replace(
      /[<>&"']/g,
      (char) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        })[char]!,
    );
  }
}
