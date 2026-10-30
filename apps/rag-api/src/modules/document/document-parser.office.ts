import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  IMAGE_MIME_BY_EXTENSION,
  uploadEmbeddedImages,
  groupImagesByPosition,
  isImageExtractionEnabled,
  hasImageStorage,
} from './document-parser.image';
import { csvToMarkdown, decodeXmlEntities } from './document-parser.text';
import { envPositiveNumber } from './document-parser.shared';
import type {
  DocumentImageExtractionOptions,
  UploadedEmbeddedImage,
  PptxImageAssets,
} from './document-parser.types';

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export function extractWorkbookText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    return [`## ${sheetName}`, '', csvToMarkdown(csv)].join('\n');
  });
  return ['# Spreadsheet Document', '', ...sections].join('\n\n').trim();
}

export async function extractPptxText(
  buffer: Buffer,
  images?: DocumentImageExtractionOptions,
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // 内嵌图片提取：失败静默降级为纯文本，保证不影响主入库链路
  let imagesBySlide: Map<number, UploadedEmbeddedImage[]> | null = null;
  let miscImages: UploadedEmbeddedImage[] = [];
  if (images && isImageExtractionEnabled() && hasImageStorage(images)) {
    try {
      const assets = await extractPptxImageAssets(zip, slideFiles);
      const all = [
        ...[...assets.bySlide.values()].flat(),
        ...assets.unattributed,
      ];
      if (all.length > 0) {
        const uploaded = await uploadEmbeddedImages(all, images);
        imagesBySlide = groupImagesByPosition(
          uploaded.filter((image) => image.position > 0),
        );
        miscImages = uploaded.filter((image) => image.position === 0);
      }
    } catch (err) {
      console.warn(
        `PPTX embedded image extraction skipped, falling back to plain text: ${
          (err as Error).message
        }`,
      );
    }
  }

  const slides: string[] = [];
  for (const [index, filename] of slideFiles.entries()) {
    const xml = await zip.files[filename].async('text');
    const blocks = extractPptxTextBlocks(xml);
    // 图片归属按 slide 文件名里的真实序号（slideN.xml），与展示序号在合规文件中一致
    const slideNum = Number(
      /slide(\d+)\.xml$/.exec(filename)?.[1] ?? index + 1,
    );
    const imageLines = (imagesBySlide?.get(slideNum) ?? []).map(
      (image) => `![${image.alt}](${image.url})`,
    );
    if (blocks.length === 0 && imageLines.length === 0) {
      continue;
    }
    const [title, ...body] = blocks;
    const lines = [
      `## Slide ${index + 1}${title ? `：${title}` : ''}`,
      '',
      ...body,
    ];
    // 插图放在对应 slide 段落之后
    if (imageLines.length > 0) {
      if (body.length > 0) {
        lines.push('');
      }
      lines.push(...imageLines);
    }
    slides.push(lines.join('\n').trim());
  }

  // 归属不明的插图统一收进「文稿插图」段
  if (miscImages.length > 0) {
    slides.push(
      [
        '## 文稿插图',
        '',
        ...miscImages.map((image) => `![${image.alt}](${image.url})`),
      ]
        .join('\n')
        .trim(),
    );
  }

  if (slides.length === 0) {
    return extractPrintableText(buffer, 'PowerPoint Document (fallback)');
  }
  return ['# PowerPoint Document', '', ...slides].join('\n\n').trim();
}

/** 单个 PPTX 允许上传的内嵌图总数上限（恶意超大 media 目录的限流保护） */
export const PPTX_IMAGE_MAX_COUNT_DEFAULT = 30;

/**
 * 提取 PPTX 内嵌图：读 ppt/media/*，并通过 slideN.xml.rels 把图归属到对应 slide。
 *
 * 归属方式：slide XML 里按 blip 引用（r:embed）出现顺序，经 rels 的 rId → media
 * 映射定位媒体文件；同一媒体被多页复用时只归属首次出现的 slide；
 * rels 解析不了 / 未被引用的媒体统一放进 unattributed（渲染为「文稿插图」段）。
 * EMF/WMF/TIFF 等无法在 Markdown 渲染的媒体类型直接忽略。
 */
export async function extractPptxImageAssets(
  zip: JSZip,
  slideFiles: string[],
): Promise<PptxImageAssets> {
  const result: PptxImageAssets = { bySlide: new Map(), unattributed: [] };
  const mediaByPath = new Map<string, { filename: string; mimeType: string }>();
  for (const name of Object.keys(zip.files)) {
    const match = /^ppt\/media\/([^/]+)$/.exec(name);
    const mimeType = match
      ? IMAGE_MIME_BY_EXTENSION[extensionOf(match[1])]
      : undefined;
    if (!match || zip.files[name].dir || !mimeType) {
      continue;
    }
    mediaByPath.set(name, { filename: match[1], mimeType });
  }
  if (mediaByPath.size === 0) {
    return result;
  }

  const maxCount = Math.max(
    1,
    envPositiveNumber('DOCUMENT_IMAGE_MAX_COUNT', PPTX_IMAGE_MAX_COUNT_DEFAULT),
  );
  let collected = 0;
  let truncated = 0;

  // 1. slide → rels → blip 引用顺序归属
  const attributed = new Set<string>();
  for (const filename of slideFiles) {
    const slideNum = Number(/slide(\d+)\.xml$/.exec(filename)?.[1] ?? 0);
    if (!slideNum) {
      continue;
    }
    const relsEntry = zip.files[`ppt/slides/_rels/slide${slideNum}.xml.rels`];
    if (!relsEntry) {
      continue; // 没有 rels 的 slide 引用不到媒体，其余媒体留给「文稿插图」
    }
    let slideXml: string;
    let relsXml: string;
    try {
      slideXml = await zip.files[filename].async('text');
      relsXml = await relsEntry.async('text');
    } catch {
      continue; // 读取失败 → 该 slide 的媒体归属不了，统一进「文稿插图」
    }
    const targetByRid = parsePptxImageRelTargets(relsXml);
    for (const match of slideXml.matchAll(/[\w.-]+:embed="([^"]+)"/g)) {
      const mediaPath = targetByRid.get(match[1]);
      if (
        !mediaPath ||
        !mediaByPath.has(mediaPath) ||
        attributed.has(mediaPath)
      ) {
        continue;
      }
      attributed.add(mediaPath);
      if (collected >= maxCount) {
        truncated += 1;
        continue;
      }
      const media = mediaByPath.get(mediaPath)!;
      const buffer = await zip.files[mediaPath].async('nodebuffer');
      if (!buffer || buffer.length === 0) {
        continue;
      }
      const list = result.bySlide.get(slideNum) ?? [];
      list.push({
        placement: `slide-${slideNum}`,
        position: slideNum,
        buffer,
        mimeType: media.mimeType,
        filename: media.filename,
      });
      result.bySlide.set(slideNum, list);
      collected += 1;
    }
  }

  // 2. 未被任何 slide 引用（或归属解析失败）的媒体 → 「文稿插图」统一段
  for (const [mediaPath, media] of mediaByPath) {
    if (attributed.has(mediaPath)) {
      continue;
    }
    if (collected >= maxCount) {
      truncated += 1;
      continue;
    }
    const buffer = await zip.files[mediaPath].async('nodebuffer');
    if (!buffer || buffer.length === 0) {
      continue;
    }
    result.unattributed.push({
      placement: 'misc',
      position: 0,
      buffer,
      mimeType: media.mimeType,
      filename: media.filename,
    });
    collected += 1;
  }

  if (truncated > 0) {
    console.warn(
      `PPTX embedded image extraction truncated at ${maxCount} image(s), skipped ${truncated}.`,
    );
  }
  return result;
}

/** 解析 slide rels：rId → ppt/media/xxx（只取 image 类型关系，Target 按文件名归一） */
export function parsePptxImageRelTargets(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const tag of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const xml = tag[0];
    const type = /Type="([^"]*)"/.exec(xml)?.[1] ?? '';
    if (!/\/image$/.test(type)) {
      continue;
    }
    const id = /Id="([^"]*)"/.exec(xml)?.[1];
    const target = /Target="([^"]*)"/.exec(xml)?.[1];
    if (!id || !target) {
      continue;
    }
    const filename = decodeURIComponent(target).split(/[\\/]/).pop();
    if (filename) {
      targets.set(id, `ppt/media/${filename}`);
    }
  }
  return targets;
}

/** 取小写扩展名（无扩展名返回空串） */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/**
 * 按段落而不是按 XML 文字节点展开：保留标题、项目符号和表格单元格的阅读顺序。
 * Office XML 异常时由调用方降级为二进制可打印文本，避免整份文档入库失败。
 */
export function extractPptxTextBlocks(xml: string): string[] {
  const paragraphs = [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)]
    .map((paragraph) => {
      const text = [...paragraph[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlEntities(match[1]).trim())
        .filter(Boolean)
        .join('');
      const bullet = /<a:bu(?:Char|AutoNum|Blip)\b/.test(paragraph[1]);
      return text ? `${bullet ? '- ' : ''}${text}` : '';
    })
    .filter(Boolean);
  return paragraphs.length > 0
    ? paragraphs
    : [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlEntities(match[1]).trim())
        .filter(Boolean);
}

export function extractPrintableText(buffer: Buffer, title: string): string {
  const raw = buffer.toString('latin1');
  const text = [...raw]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13) return char;
      if (code >= 32 && code <= 126) return char;
      if (code >= 0x4e00 && code <= 0x9fff) return char;
      return ' ';
    })
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [
    `# ${title}`,
    '',
    text || 'Legacy binary file stored for retrieval metadata.',
  ]
    .join('\n')
    .trim();
}

export function mediaFallbackMarkdown(title: string, buffer: Buffer): string {
  return [
    `# ${title}`,
    '',
    `Binary media file received (${buffer.length} bytes).`,
    'Detailed OCR / ASR / video understanding is handled by the ingestion pipeline when the configured provider is available.',
  ].join('\n');
}
