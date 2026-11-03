import { createHash } from 'node:crypto';
import type { ParsedBlock, ParsedDocument } from './document-parser.types';
import type { HybridChunk } from './hybrid-document-chunker';

const MAX_PARENT_CHARS = 6000;

function meta(block: ParsedBlock, key: string): string {
  return String(block.metadata?.[key] ?? '');
}
function numberMeta(block: ParsedBlock, key: string, fallback: number): number {
  const value = Number(block.metadata?.[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Each symbol has a stable parent key; huge functions split only at line boundaries. */
export function splitCodeDocument(input: {
  docId: string;
  filename: string;
  parsedDocument: ParsedDocument;
  chunkSize: number;
  chunkOverlap: number;
}): HybridChunk[] {
  const output: HybridChunk[] = [];
  const maxChars = Math.max(500, Math.min(8000, Math.floor(input.chunkSize * 3.25)));
  const overlapChars = Math.min(Math.floor(maxChars / 4), Math.max(0, input.chunkOverlap * 3));

  for (const block of input.parsedDocument.blocks.filter((candidate) => candidate.type === 'code' && candidate.text.trim())) {
    const filePath = meta(block, 'filePath') || input.filename;
    const language = meta(block, 'language') || 'text';
    const symbol = meta(block, 'symbol') || '<module>';
    const symbolKind = meta(block, 'symbolKind') || 'module';
    const firstLine = numberMeta(block, 'startLine', 1);
    const parentSymbol = meta(block, 'parentSymbol');
    const imports = (() => {
      try {
        const value: unknown = JSON.parse(meta(block, 'imports') || '[]');
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 60) : [];
      } catch { return []; }
    })();
    const parentId = createHash('sha256')
      .update(`${input.docId}\0${filePath}\0${symbol}\0${firstLine}`)
      .digest('hex').slice(0, 36);
    const lines = block.text.split('\n');
    const pieces: { start: number; end: number; text: string }[] = [];
    let i = 0;
    while (i < lines.length) {
      const start = i;
      let chars = 0;
      while (i < lines.length && (chars + lines[i].length + 1 <= maxChars || i === start)) {
        chars += lines[i].length + 1;
        i++;
      }
      const end = i;
      pieces.push({ start, end, text: lines.slice(start, end).join('\n') });
      // Avoid duplicating an entire window when chunking very short files.
      if (i < lines.length && overlapChars > 0) {
        let previous = i;
        let used = 0;
        while (previous > start + 1 && used + lines[previous - 1].length + 1 <= overlapChars) {
          previous--;
          used += lines[previous].length + 1;
        }
        i = previous;
      }
    }
    for (const part of pieces) {
      const prefix = `File: ${filePath}\nLanguage: ${language}\nSymbol: ${symbol} (${symbolKind})\n`;
      const content = prefix + part.text;
      const lineStart = firstLine + part.start;
      const lineEnd = firstLine + part.end - 1;
      const rawParent = `${prefix}${block.text}`;
      const hit = rawParent.indexOf(part.text.slice(0, 80));
      const windowStart = Math.max(0, Math.min(hit < 0 ? 0 : hit - 400, Math.max(0, rawParent.length - MAX_PARENT_CHARS)));
      output.push({
        content,
        chunkIndex: output.length,
        parentChunkId: parentId,
        parentContent: rawParent.slice(windowStart, windowStart + MAX_PARENT_CHARS),
        headingPath: [filePath, symbol],
        sectionId: parentId,
        clauseId: null,
        tableRef: null,
        sourceStart: block.sourceStart ?? null,
        sourceEnd: block.sourceEnd ?? null,
        sourceMetadata: {
          filename: filePath,
          kind: 'code',
          filePath,
          language,
          symbol,
          symbolKind,
          parentSymbol,
          startLine: lineStart,
          endLine: lineEnd,
          imports,
        },
      });
    }
  }
  return output;
}
