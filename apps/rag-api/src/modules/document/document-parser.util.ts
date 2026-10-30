import { BadRequestException } from '@nestjs/common';
import type {
  DocumentImageExtractionOptions,
  DocumentOcrDelegate,
  DocumentVideoExtractionOptions,
  SupportedDocumentKind,
} from './document-parser.types';
import { extractPdfText } from './document-parser.pdf-content';
import {
  extractDocxText,
  extractWorkbookText,
  extractPptxText,
  extractPrintableText,
} from './document-parser.office';
import {
  csvToMarkdown,
  htmlToText,
  jsonToMarkdown,
} from './document-parser.text';
import { extractVideoDocumentText } from './document-parser.media';
export type {
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

/**
 * 提取文档文本。
 *
 * 仅 PDF 分支支持可选的 OCR 兜底：当 PDF 没有文本层（扫描件）时，
 * 会把页面渲染成图片并调用 `ocr` 识别，其他格式行为与原先完全一致。
 *
 * PDF / PPTX 分支额外支持可选的内嵌图片提取（`images`）：把文档里的内嵌图
 * 上传到对象存储并在 Markdown 中插入 `![alt](url)`；扫描件走 OCR 路径时
 * 不再重复提取（OCR 页图是渲染产物，不是内嵌图）。
 *
 * video 分支支持可选的视频入库参数（`video`）：ffmpeg 抽音轨 + 关键帧，
 * 音轨走 ASR、关键帧走 Vision，合成带概览/转写/画面要点的 Markdown。
 *
 * @param buffer 文档二进制内容
 * @param kind 文档类型
 * @param ocr 可选的 OCR 依赖（通常传 VisionProvider）；扫描件 PDF 缺少它时会抛出明确错误
 * @param images 可选的内嵌图片提取参数；未提供或对象存储异常时保持纯文本提取
 * @param video 可选的视频入库参数；未提供时视频退回元数据占位 Markdown
 */
export async function extractDocumentText(
  buffer: Buffer,
  kind: SupportedDocumentKind,
  ocr?: DocumentOcrDelegate,
  images?: DocumentImageExtractionOptions,
  video?: DocumentVideoExtractionOptions,
  options: { preservePdfPages?: boolean } = {},
): Promise<string> {
  // 不同格式在这里归一成正文 Markdown；下游切块和索引无需感知原始文件格式。
  switch (kind) {
    case 'markdown':
    case 'text':
      return buffer.toString('utf-8');
    case 'pdf':
      return extractPdfText(buffer, ocr, images, options.preservePdfPages);
    case 'docx':
      return extractDocxText(buffer);
    case 'doc':
      return extractPrintableText(buffer, 'Legacy Word Document');
    case 'xlsx':
    case 'xls':
      return extractWorkbookText(buffer);
    case 'pptx':
      return extractPptxText(buffer, images);
    case 'ppt':
      return extractPrintableText(buffer, 'Legacy PowerPoint Document');
    case 'csv':
      return csvToMarkdown(buffer.toString('utf-8'));
    case 'json':
      return jsonToMarkdown(buffer.toString('utf-8'));
    case 'html':
      return htmlToText(buffer.toString('utf-8'));
    case 'image':
      throw new BadRequestException(
        'Image must be analyzed with extractImageDocumentText before it can be indexed.',
      );
    case 'audio':
      throw new BadRequestException(
        'Audio must be transcribed with extractAudioDocumentText before it can be indexed.',
      );
    case 'video':
      if (!video) {
        throw new BadRequestException(
          'Video must be parsed with extractVideoDocumentText before it can be indexed.',
        );
      }
      return extractVideoDocumentText(buffer, video);
  }
}
