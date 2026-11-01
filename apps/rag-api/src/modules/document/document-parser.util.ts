import { BadRequestException } from '@nestjs/common';
import type {
  DocumentImageExtractionOptions,
  DocumentAsrDelegate,
  DocumentOcrDelegate,
  ParsedBlock,
  ParsedDocument,
  ParsedDocumentWarning,
  DocumentVideoExtractionOptions,
  SupportedDocumentKind,
} from './document-parser.types';
import { parsePdfDocument } from './document-parser.pdf-content';
import { parseOfficeDocument } from './document-parser.office';
import {
  csvToMarkdown,
  htmlToText,
  jsonToMarkdown,
} from './document-parser.text';
import {
  parseAudioDocument,
  parseVideoDocument,
} from './document-parser.media';
import { validateDocumentFormat } from './document-parser.validation';
export { validateDocumentFormat } from './document-parser.validation';
export type {
  ParsedBlock,
  ParsedBlockType,
  ParsedDocument,
  ParsedDocumentStatus,
  ParsedDocumentWarning,
  SupportedDocumentKind,
  UrlExtractionResult,
  DocumentOcrDelegate,
  DocumentImageStorageDelegate,
  DocumentImageAltDelegate,
  DocumentImageUnderstandingDelegate,
  DocumentImageExtractionOptions,
  DocumentAsrDelegate,
  DocumentVideoExtractionOptions,
} from './document-parser.types';
export { extractImageDocumentText } from './document-parser.image';
export {
  extractAudioDocumentText,
  extractVideoDocumentText,
} from './document-parser.media';
export { extractUrlContent, extractUrlText } from './document-parser.url';

export function detectDocumentKind(filename: string): SupportedDocumentKind {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lowerName.endsWith('.txt')) {
    return 'text';
  }
  if (lowerName.endsWith('.pdf')) {
    return 'pdf';
  }
  if (lowerName.endsWith('.docx')) {
    return 'docx';
  }
  if (lowerName.endsWith('.doc')) {
    return 'doc';
  }
  if (lowerName.endsWith('.xlsx')) {
    return 'xlsx';
  }
  if (lowerName.endsWith('.xls')) {
    return 'xls';
  }
  if (lowerName.endsWith('.pptx')) {
    return 'pptx';
  }
  if (lowerName.endsWith('.ppt')) {
    return 'ppt';
  }
  if (lowerName.endsWith('.csv')) {
    return 'csv';
  }
  if (lowerName.endsWith('.json')) {
    return 'json';
  }
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    return 'html';
  }
  if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(lowerName)) {
    return 'image';
  }
  if (/\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(lowerName)) {
    return 'audio';
  }
  if (/\.(mp4|mov|m4v|webm)$/i.test(lowerName)) {
    return 'video';
  }

  throw new BadRequestException(
    'only document, url, image, audio and video knowledge files are supported',
  );
}

/** 兼容旧调用的 string API；新入库链路应使用结构化的 `parseDocument`。 */
export async function extractDocumentText(
  buffer: Buffer,
  kind: SupportedDocumentKind,
  ocr?: DocumentOcrDelegate,
  images?: DocumentImageExtractionOptions,
  video?: DocumentVideoExtractionOptions,
  options: {
    preservePdfPages?: boolean;
    filename?: string;
    audioAsr?: DocumentAsrDelegate;
  } = {},
): Promise<string> {
  const parsed = await parseDocument(buffer, kind, ocr, images, video, options);
  if (parsed.status === 'failed') {
    throw new BadRequestException(
      parsed.warnings.map((warning) => warning.message).join('; ') ||
        'document parser produced no usable content',
    );
  }
  return parsed.markdown;
}

/** 统一解析入口：格式校验和各格式解析结果都归一到 ParsedDocument。 */
export async function parseDocument(
  buffer: Buffer,
  kind: SupportedDocumentKind,
  ocr?: DocumentOcrDelegate,
  images?: DocumentImageExtractionOptions,
  video?: DocumentVideoExtractionOptions,
  options: {
    preservePdfPages?: boolean;
    filename?: string;
    audioAsr?: DocumentAsrDelegate;
  } = {},
): Promise<ParsedDocument> {
  const filename = options.filename ?? `upload.${kind}`;
  await validateDocumentFormat(buffer, kind, filename);

  switch (kind) {
    case 'markdown':
    case 'text':
    case 'csv':
    case 'json':
    case 'html': {
      const text = buffer.toString('utf-8');
      if (text.includes('\u0000')) {
        throw new BadRequestException(
          `text document contains binary data: ${filename}`,
        );
      }
      let markdown = text;
      if (kind === 'csv') markdown = csvToMarkdown(text);
      if (kind === 'json') {
        try {
          markdown = jsonToMarkdown(text);
        } catch {
          throw new BadRequestException(`invalid JSON document: ${filename}`);
        }
      }
      if (kind === 'html') markdown = htmlToText(text);
      return createParsedDocument(kind, filename, markdown);
    }
    case 'pdf':
      try {
        return await parsePdfDocument(
          buffer,
          ocr,
          images,
          options.preservePdfPages ?? false,
        );
      } catch (error) {
        return failedParsedDocument(kind, filename, 'pdf_parse_failed', error);
      }
    case 'docx':
    case 'xlsx':
    case 'xls':
    case 'pptx':
      return parseOfficeDocument(buffer, kind, images);
    case 'doc':
      return failedParsedDocument(
        kind,
        filename,
        'legacy_format_unsupported',
        new Error(
          'Legacy .doc files require a verified binary document parser; convert the file to .docx.',
        ),
      );
    case 'ppt':
      return failedParsedDocument(
        kind,
        filename,
        'legacy_format_unsupported',
        new Error(
          'Legacy .ppt files require a verified binary presentation parser; convert the file to .pptx.',
        ),
      );
    case 'image':
      return failedParsedDocument(
        kind,
        filename,
        'image_parser_not_configured',
        new Error(
          'Image must be analyzed with extractImageDocumentText before it can be indexed.',
        ),
      );
    case 'audio':
      try {
        return await parseAudioDocument(buffer, filename, options.audioAsr);
      } catch (error) {
        return failedParsedDocument(
          kind,
          filename,
          'audio_parse_failed',
          error,
        );
      }
    case 'video':
      try {
        return await parseVideoDocument(
          buffer,
          video ? { ...video, filename: video.filename ?? filename } : video,
        );
      } catch (error) {
        return failedParsedDocument(
          kind,
          filename,
          'video_parse_failed',
          error,
        );
      }
  }
}

/** 把纯文本/Markdown 解析为定位信息有限但结构可用的统一结果。 */
export function createParsedDocument(
  kind: SupportedDocumentKind,
  filename: string,
  markdown: string,
  warnings: ParsedDocumentWarning[] = [],
): ParsedDocument {
  const normalized = markdown.trim();
  const blocks = markdownToParsedBlocks(normalized);
  const usable = blocks.some((block) => block.text.trim() || block.asset?.url);
  return {
    kind,
    title: filename.replace(/\\/g, '/').split('/').pop() ?? filename,
    blocks,
    markdown: normalized,
    status: !usable ? 'failed' : warnings.length > 0 ? 'partial' : 'complete',
    completeness: !usable ? 0 : warnings.length > 0 ? 0.9 : 1,
    warnings,
  };
}

function failedParsedDocument(
  kind: SupportedDocumentKind,
  filename: string,
  code: string,
  error: unknown,
): ParsedDocument {
  return {
    kind,
    title: filename,
    blocks: [],
    markdown: '',
    status: 'failed',
    completeness: 0,
    warnings: [
      {
        code,
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

function markdownToParsedBlocks(markdown: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const headingPath: string[] = [];
  const lines = markdown.split('\n');
  let offset = 0;
  let pageNumber: number | undefined;
  let sheetName: string | undefined;

  for (const line of lines) {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    if (!line.trim()) continue;

    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      headingPath.length = level - 1;
      headingPath.push(text);
      const page = /^第\s*(\d+)\s*页$/.exec(text);
      const sheet = /^(?:工作表|Sheet)\s*[:：]?\s*(.+)$/i.exec(text);
      if (page) pageNumber = Number(page[1]);
      if (sheet) sheetName = sheet[1].trim();
      blocks.push({
        type: level === 1 ? 'title' : 'heading',
        text,
        level,
        headingPath: [...headingPath],
        pageNumber,
        sheetName,
        sourceStart: start,
        sourceEnd: end,
      });
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (image) {
      blocks.push({
        type: 'image',
        text: image[1] || '图片',
        asset: { url: image[2], alt: image[1] || '图片' },
        headingPath: [...headingPath],
        pageNumber,
        sheetName,
        sourceStart: start,
        sourceEnd: end,
      });
      continue;
    }

    blocks.push({
      type: /^\s*\|.+\|\s*$/.test(line) ? 'table' : 'paragraph',
      text: line.trim(),
      headingPath: [...headingPath],
      pageNumber,
      sheetName,
      sourceStart: start,
      sourceEnd: end,
    });
  }

  return blocks;
}
