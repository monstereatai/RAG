import { BadRequestException } from '@nestjs/common';
import {
  IMAGE_ALT_CONCURRENCY,
  mapWithConcurrency,
  envPositiveNumber,
} from './document-parser.shared';
import type {
  DocumentImageUnderstandingDelegate,
  DocumentImageExtractionOptions,
  EmbeddedImageAsset,
  UploadedEmbeddedImage,
} from './document-parser.types';

/** 图片至少要产出 OCR 或视觉描述，不能把二进制大小当成可检索正文。 */
export async function extractImageDocumentText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  vision?: DocumentImageUnderstandingDelegate,
): Promise<string> {
  if (!vision) {
    throw new BadRequestException(
      '图片入库需要配置 OCR 或视觉理解服务，当前文件未建立文本索引。',
    );
  }
  const capabilities = vision.getCapabilities();
  if (!capabilities.ocr && !capabilities.imageUnderstanding) {
    throw new BadRequestException(
      '当前视觉服务不支持 OCR 或图片理解，图片未建立文本索引。',
    );
  }

  const sections = [`# 图片资料：${filename}`];
  const errors: string[] = [];
  if (capabilities.ocr) {
    try {
      const text = (await vision.ocr(buffer, mimeType)).text.trim();
      if (text) sections.push(`## OCR 文字\n\n${text}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (capabilities.imageUnderstanding) {
    try {
      const result = await vision.describeImage(buffer, mimeType);
      const description = result.description.trim();
      if (description) sections.push(`## 图片内容\n\n${description}`);
      if (result.tags?.length) {
        sections.push(`标签：${result.tags.join('、')}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (sections.length === 1) {
    const details = errors.length > 0 ? `：${errors.join('；')}` : '';
    throw new BadRequestException(
      `图片解析失败${details || '，没有识别到文字或图像内容'}`,
    );
  }
  return sections.join('\n\n');
}

/* ── 内嵌图片：上传与 alt 生成（PDF / PPTX 共用） ── */
/** 图片扩展名 → MIME（PPTX ppt/media 按扩展名识别） */
export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** MIME → 对象存储 key 的扩展名 */
export const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

/**
 * 通用上传流程：逐张写入对象存储（key 形如 documents/{docId}/images/page-2-1.png），
 * 再批量生成 alt（并发 ≤2、总数上限 DOCUMENT_IMAGE_ALT_MAX_COUNT 张）。
 *
 * 任何上传异常向上抛出，由调用方整体降级为纯文本——保证不影响主入库链路。
 */
export async function uploadEmbeddedImages(
  assets: EmbeddedImageAsset[],
  images: DocumentImageExtractionOptions,
): Promise<UploadedEmbeddedImage[]> {
  const folder = images.docId?.trim() || `doc-${Date.now()}`;
  const ownerPrefix = images.ownerUserId
    ? `${sanitizeObjectKeyPart(images.ownerUserId)}/`
    : '';
  const counters = new Map<string, number>();
  const uploaded: UploadedEmbeddedImage[] = [];
  for (const asset of assets) {
    const seq = (counters.get(asset.placement) ?? 0) + 1;
    counters.set(asset.placement, seq);
    const extension = IMAGE_EXTENSION_BY_MIME[asset.mimeType] ?? 'bin';
    const stored = await images.storage.putObject({
      key: `documents/${ownerPrefix}${folder}/images/${asset.placement}-${seq}.${extension}`,
      body: asset.buffer,
      contentType: asset.mimeType,
    });
    uploaded.push({
      position: asset.position,
      url: images.urlResolver ? images.urlResolver(stored) : stored.url,
      alt: '',
    });
  }

  // alt 批量生成：并发 ≤2、总数有上限，失败或未配置 vision 时回退为文件名，绝不阻塞入库
  const altLimit = Math.max(
    0,
    envPositiveNumber('DOCUMENT_IMAGE_ALT_MAX_COUNT', 10),
  );
  const alts = await mapWithConcurrency(
    assets.slice(0, altLimit),
    IMAGE_ALT_CONCURRENCY,
    (asset) => describeEmbeddedImage(asset, images),
  );
  return uploaded.map((image, index) => ({
    ...image,
    alt:
      index < alts.length
        ? alts[index]
        : toMarkdownAltText('', assets[index].filename),
  }));
}

export function sanitizeObjectKeyPart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

/** 单张图片的 alt：vision 描述失败时回退文件名 */
export async function describeEmbeddedImage(
  asset: EmbeddedImageAsset,
  images: DocumentImageExtractionOptions,
): Promise<string> {
  const fallback = toMarkdownAltText('', asset.filename);
  const vision = images.vision;
  if (!vision || typeof vision.describeImage !== 'function') {
    return fallback;
  }
  try {
    const result = await vision.describeImage(
      asset.buffer,
      asset.mimeType,
      '请将这张图片作为知识库证据解析。先判断类型（截图、流程图、架构图、表格图或其他），再描述关键文字、节点、连线、表格字段和业务上下文；输出适合检索的中文语义摘要，避免臆测图片中未出现的信息。',
    );
    return toMarkdownAltText(result?.description, fallback);
  } catch (err) {
    console.warn(
      `embedded image alt generation failed for ${asset.filename}: ${
        (err as Error).message
      }`,
    );
    return fallback;
  }
}

/** 清洗 alt 文本：剔除会破坏 `![alt](url)` 语法的字符，空值回退文件名 */
export function toMarkdownAltText(
  raw: string | undefined | null,
  fallback: string,
): string {
  const cleaned = (raw ?? '')
    .replace(/[[\]]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

/** 图片按归属序号（页码/slide 号）分组，组内保持上传顺序 */
export function groupImagesByPosition(
  uploaded: UploadedEmbeddedImage[],
): Map<number, UploadedEmbeddedImage[]> {
  const grouped = new Map<number, UploadedEmbeddedImage[]>();
  for (const image of uploaded) {
    const list = grouped.get(image.position) ?? [];
    list.push(image);
    grouped.set(image.position, list);
  }
  return grouped;
}

/** 功能开关：DOCUMENT_EXTRACT_IMAGES（默认开启；显式 false/0/off/no 关闭） */
export function isImageExtractionEnabled(): boolean {
  const raw = (process.env.DOCUMENT_EXTRACT_IMAGES ?? '').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(raw);
}

/** 内嵌图片提取参数是否带有可用的对象存储委托 */
export function hasImageStorage(
  images?: DocumentImageExtractionOptions,
): images is DocumentImageExtractionOptions {
  return Boolean(
    images && images.storage && typeof images.storage.putObject === 'function',
  );
}
