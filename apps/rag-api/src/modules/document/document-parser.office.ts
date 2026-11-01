import { BadRequestException } from '@nestjs/common';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { posix } from 'node:path';
import {
  IMAGE_MIME_BY_EXTENSION,
  uploadEmbeddedImages,
  groupImagesByPosition,
  isImageExtractionEnabled,
  hasImageStorage,
} from './document-parser.image';
import { decodeXmlEntities } from './document-parser.text';
import { envPositiveNumber } from './document-parser.shared';
import type {
  DocumentImageExtractionOptions,
  ParsedBlock,
  ParsedDocument,
  ParsedDocumentWarning,
  SupportedDocumentKind,
  UploadedEmbeddedImage,
  PptxImageAssets,
} from './document-parser.types';

const OFFICE_TITLE: Record<'docx' | 'xlsx' | 'xls' | 'pptx', string> = {
  docx: 'Word Document',
  xlsx: 'Spreadsheet Document',
  xls: 'Spreadsheet Document',
  pptx: 'PowerPoint Document',
};

type PptxImageAssetsWithWarnings = PptxImageAssets & {
  warnings: ParsedDocumentWarning[];
};

/**
 * 将 DOCX 解析成可定位结构块。Mammoth 生成的 HTML 保留标题、段落、表格和图片顺序，
 * messages 会进入 warnings；内嵌图片保留位置、类型和替代文本，原图仍由原文件存储负责。
 */
export async function parseDocxDocument(
  buffer: Buffer,
): Promise<ParsedDocument> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    await assertOoxmlPackage(zip, 'docx');
    const result = await mammoth.convertToHtml({ buffer });
    const warnings = mammothWarnings(result.messages ?? []);
    const blocks = parseMammothHtml(result.value, warnings);
    return createParsedDocument('docx', OFFICE_TITLE.docx, blocks, warnings);
  } catch (error) {
    return failedDocument(
      'docx',
      OFFICE_TITLE.docx,
      'docx_parse_failed',
      error,
    );
  }
}

/** 兼容现有 string API；解析失败时抛出明确错误，不生成二进制占位正文。 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  return markdownOrThrow(await parseDocxDocument(buffer));
}

/** 解析现代 XLSX，按工作表保留二维行列位置及公式信息。 */
export function parseXlsxDocument(buffer: Buffer): ParsedDocument {
  return parseWorkbookDocument(buffer, 'xlsx');
}

/** 兼容旧 XLS 的现有 SheetJS 解析能力，同时保留工作表和行列结构。 */
export function parseXlsDocument(buffer: Buffer): ParsedDocument {
  return parseWorkbookDocument(buffer, 'xls');
}

/** Office 解析统一入口；格式校验、结构解析和失败状态在此归一。 */
export async function parseOfficeDocument(
  buffer: Buffer,
  kind: 'docx' | 'xlsx' | 'xls' | 'pptx',
  images?: DocumentImageExtractionOptions,
): Promise<ParsedDocument> {
  if (kind === 'docx') return parseDocxDocument(buffer);
  if (kind === 'pptx') return parsePptxDocument(buffer, images);
  if (kind === 'xls') return parseXlsDocument(buffer);
  try {
    const zip = await JSZip.loadAsync(buffer);
    await assertOoxmlPackage(zip, 'xlsx');
    return parseXlsxDocument(buffer);
  } catch (error) {
    return failedDocument(
      'xlsx',
      OFFICE_TITLE.xlsx,
      'xlsx_parse_failed',
      error,
    );
  }
}

function parseWorkbookDocument(
  buffer: Buffer,
  kind: 'xlsx' | 'xls',
): ParsedDocument {
  const title = OFFICE_TITLE[kind];
  try {
    if (kind === 'xlsx') {
      // 先验证 ZIP 头，避免把任意文本/二进制交给 SheetJS 后误认成空工作簿。
      assertZipSignature(buffer, 'xlsx');
    } else {
      assertOleSignature(buffer, 'xls');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer', WTF: true });
    if (workbook.SheetNames.length === 0) {
      throw new Error('Workbook contains no worksheets.');
    }
    const blocks: ParsedBlock[] = [];
    const warnings: ParsedDocumentWarning[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const ref = sheet?.['!ref'];
      if (!sheet || !ref) {
        warnings.push({
          code: 'worksheet_has_no_cells',
          message: `工作表“${sheetName}”没有可解析的单元格。`,
          sheetName,
        });
        continue;
      }

      const range = XLSX.utils.decode_range(ref);
      const rows: string[][] = [];
      for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
        const row: string[] = [];
        for (
          let columnIndex = range.s.c;
          columnIndex <= range.e.c;
          columnIndex += 1
        ) {
          const cell = asRecord(
            sheet[
              XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
            ] as unknown,
          );
          const value = cell.v;
          const display =
            typeof cell.w === 'string' || typeof cell.w === 'number'
              ? String(cell.w)
              : typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean'
                ? String(value)
                : value instanceof Date
                  ? value.toISOString()
                  : '';
          const formula = typeof cell.f === 'string' ? cell.f : '';
          row.push(formula ? `${display}（公式: ${formula}）` : display);
        }
        rows.push(row);
      }
      const markdown = rowsToMarkdown(rows);
      if (!markdown) {
        warnings.push({
          code: 'worksheet_has_no_text',
          message: `工作表“${sheetName}”未提取到正文。`,
          sheetName,
        });
        continue;
      }
      blocks.push({
        type: 'table',
        text: markdown,
        sheetName,
        metadata: {
          rows: rows.length,
          columns: rows.reduce((max, row) => Math.max(max, row.length), 0),
          startRow: range.s.r + 1,
          endRow: range.e.r + 1,
          startColumn: range.s.c + 1,
          endColumn: range.e.c + 1,
          cellRange: ref,
        },
      });
    }
    return createParsedDocument(kind, title, blocks, warnings);
  } catch (error) {
    return failedDocument(
      kind,
      title,
      kind === 'xlsx' ? 'xlsx_parse_failed' : 'xls_parse_failed',
      error,
    );
  }
}

/** 兼容现有 XLS/XLSX string API。 */
export function extractWorkbookText(buffer: Buffer): string {
  const kind = isZipBuffer(buffer) ? 'xlsx' : 'xls';
  const parsed =
    kind === 'xlsx' ? parseXlsxDocument(buffer) : parseXlsDocument(buffer);
  return markdownOrThrow(parsed);
}

/** 将 PPTX 解析成 slide、段落、表格、图片和图表结构块。 */
export async function parsePptxDocument(
  buffer: Buffer,
  images?: DocumentImageExtractionOptions,
): Promise<ParsedDocument> {
  const title = OFFICE_TITLE.pptx;
  const warnings: ParsedDocumentWarning[] = [];
  try {
    const zip = await JSZip.loadAsync(buffer);
    await assertOoxmlPackage(zip, 'pptx');
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (slideFiles.length === 0) {
      throw new Error('PowerPoint package contains no slides.');
    }

    const { imagesBySlide, miscImages } = await uploadPptxImages(
      zip,
      slideFiles,
      images,
      warnings,
    );
    const blocks: ParsedBlock[] = [];
    if (miscImages.length > 0) {
      warnings.push({
        code: 'pptx_image_attribution_incomplete',
        message: `${miscImages.length} 张图片无法关联到具体幻灯片，已作为独立图片块保留。`,
      });
    }

    for (const filename of slideFiles) {
      const slideNumber = Number(/slide(\d+)\.xml$/.exec(filename)?.[1]);
      const slideXml = await zip.files[filename].async('text');
      if (!/<p:sld\b/.test(slideXml)) {
        warnings.push({
          code: 'pptx_slide_xml_invalid',
          message: `第 ${slideNumber} 张幻灯片 XML 结构无效。`,
          slideNumber,
        });
        continue;
      }
      const relationPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
      const relationXml = zip.files[relationPath]
        ? await zip.files[relationPath].async('text')
        : '';
      const relations = parseRelationships(relationXml, filename);
      const shapes = [
        ...slideXml.matchAll(
          /<p:(?:sp|graphicFrame|pic)\b[\s\S]*?<\/p:(?:sp|graphicFrame|pic)>/g,
        ),
      ];
      blocks.push({
        type: 'heading',
        text: `第 ${slideNumber} 张幻灯片`,
        level: 2,
        slideNumber,
        headingPath: [title, `第 ${slideNumber} 张幻灯片`],
        metadata: { structuralOnly: true },
      });

      let imageIndex = 0;
      for (const shapeMatch of shapes) {
        const shape = shapeMatch[0];
        if (/<a:tbl\b/.test(shape)) {
          const tableXml = /<a:tbl\b[\s\S]*?<\/a:tbl>/.exec(shape)?.[0];
          if (tableXml) {
            const table = parsePptxTable(tableXml);
            if (table.text) {
              blocks.push({
                type: 'table',
                text: table.text,
                slideNumber,
                metadata: { rows: table.rows, columns: table.columns },
              });
            } else {
              warnings.push({
                code: 'pptx_table_content_empty',
                message: `第 ${slideNumber} 张幻灯片中的表格没有可读取的单元格内容。`,
                slideNumber,
              });
            }
          } else {
            warnings.push({
              code: 'pptx_table_xml_invalid',
              message: `第 ${slideNumber} 张幻灯片的表格 XML 结构无效。`,
              slideNumber,
            });
          }
        } else if (/<p:pic\b/.test(shape)) {
          const imageRelId = /\br:embed="([^"]+)"/.exec(shape)?.[1];
          if (
            !imageRelId ||
            !relations.get(imageRelId)?.type.endsWith('/image')
          ) {
            warnings.push({
              code: 'pptx_image_relationship_missing',
              message: `第 ${slideNumber} 张幻灯片的图片没有可读取的媒体关系。`,
              slideNumber,
            });
          }
          const imageBlock = parsePptxImageBlock(
            shape,
            relations,
            slideNumber,
            imagesBySlide?.get(slideNumber)?.[imageIndex],
            imageIndex + 1,
          );
          imageIndex += 1;
          if (imageBlock) {
            blocks.push(imageBlock);
            if (!imageBlock.asset?.url) {
              warnings.push({
                code: 'pptx_image_not_materialized',
                message: `第 ${slideNumber} 张幻灯片包含图片；解析保留了位置和说明，但未生成可检索的图片描述。`,
                slideNumber,
              });
            }
          }
        } else if (/<p:graphicFrame\b/.test(shape)) {
          const chartId = /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(shape)?.[1];
          if (chartId) {
            const relation = relations.get(chartId);
            const chartPath = relation?.type.endsWith('/chart')
              ? relation.target
              : undefined;
            const chartEntry = chartPath ? zip.files[chartPath] : undefined;
            if (!chartEntry) {
              warnings.push({
                code: 'pptx_chart_part_missing',
                message: `第 ${slideNumber} 张幻灯片引用的图表部件不存在。`,
                slideNumber,
              });
              continue;
            }
            const chartXml = await chartEntry.async('text');
            const chart = extractPptxChartData(chartXml);
            if (!chart.text) {
              warnings.push({
                code: 'pptx_chart_data_empty',
                message: `第 ${slideNumber} 张幻灯片的图表没有可读取的标题或缓存数据。`,
                slideNumber,
              });
              continue;
            }
            blocks.push({
              type: 'chart',
              text: chart.text,
              slideNumber,
              metadata: {
                series: chart.seriesCount,
                dataPoints: chart.pointCount,
                ...(chartPath ? { chartPath } : {}),
              },
            });
          }
        } else {
          const paragraphs = extractPptxTextBlocks(shape);
          for (const paragraph of paragraphs) {
            if (!paragraph.trim()) continue;
            const isTitle = /<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(
              shape,
            );
            blocks.push({
              type: isTitle ? 'heading' : 'paragraph',
              text: paragraph,
              ...(isTitle ? { level: 3 } : {}),
              slideNumber,
              headingPath: [title, `第 ${slideNumber} 张幻灯片`],
            });
          }
        }
      }
      if (!shapes.length) {
        warnings.push({
          code: 'pptx_slide_has_no_shapes',
          message: `第 ${slideNumber} 张幻灯片没有可解析内容。`,
          slideNumber,
        });
      }
    }

    for (const image of miscImages) {
      blocks.push({
        type: 'image',
        text: `![${image.alt}]`,
        asset: { url: image.url, alt: image.alt },
        metadata: { placement: 'unattributed' },
      });
    }
    return createParsedDocument('pptx', title, blocks, warnings);
  } catch (error) {
    return failedDocument('pptx', title, 'pptx_parse_failed', error, warnings);
  }
}

/** 兼容现有 string API；失败结果明确抛错，不扫描二进制伪造正文。 */
export async function extractPptxText(
  buffer: Buffer,
  images?: DocumentImageExtractionOptions,
): Promise<string> {
  return markdownOrThrow(await parsePptxDocument(buffer, images));
}

async function uploadPptxImages(
  zip: JSZip,
  slideFiles: string[],
  images: DocumentImageExtractionOptions | undefined,
  warnings: ParsedDocumentWarning[],
): Promise<{
  imagesBySlide: Map<number, UploadedEmbeddedImage[]> | null;
  miscImages: UploadedEmbeddedImage[];
}> {
  if (!images || !isImageExtractionEnabled() || !hasImageStorage(images)) {
    return { imagesBySlide: null, miscImages: [] };
  }
  try {
    const assets = await extractPptxImageAssets(zip, slideFiles);
    warnings.push(...assets.warnings);
    const all = [
      ...[...assets.bySlide.values()].flat(),
      ...assets.unattributed,
    ];
    if (all.length === 0) {
      return { imagesBySlide: new Map(), miscImages: [] };
    }
    const uploaded = await uploadEmbeddedImages(all, images);
    return {
      imagesBySlide: groupImagesByPosition(
        uploaded.filter((image) => image.position > 0),
      ),
      miscImages: uploaded.filter((image) => image.position === 0),
    };
  } catch (error) {
    warnings.push({
      code: 'pptx_image_extraction_failed',
      message: `PPTX 图片提取失败：${errorMessage(error)}`,
    });
    return { imagesBySlide: null, miscImages: [] };
  }
}

/** 单个 PPTX 允许上传的内嵌图总数上限（恶意超大 media 目录的限流保护） */
export const PPTX_IMAGE_MAX_COUNT_DEFAULT = 30;

/**
 * 提取 PPTX 内嵌图：读 ppt/media/*，并通过 slideN.xml.rels 把图归属到对应 slide。
 * 未能归属的媒体保存在 unattributed，调用方会将其作为图片块并记录来源不完整。
 */
export async function extractPptxImageAssets(
  zip: JSZip,
  slideFiles: string[],
): Promise<PptxImageAssetsWithWarnings> {
  const result: PptxImageAssetsWithWarnings = {
    bySlide: new Map(),
    unattributed: [],
    warnings: [],
  };
  const mediaByPath = new Map<string, { filename: string; mimeType: string }>();
  for (const name of Object.keys(zip.files)) {
    const match = /^ppt\/media\/([^/]+)$/.exec(name);
    const mimeType = match
      ? IMAGE_MIME_BY_EXTENSION[extensionOf(match[1])]
      : undefined;
    if (!match || zip.files[name].dir || !mimeType) continue;
    mediaByPath.set(name, { filename: match[1], mimeType });
  }
  if (mediaByPath.size === 0) return result;

  const maxCount = Math.max(
    1,
    envPositiveNumber('DOCUMENT_IMAGE_MAX_COUNT', PPTX_IMAGE_MAX_COUNT_DEFAULT),
  );
  let collected = 0;
  let truncated = 0;
  const attributed = new Set<string>();
  for (const filename of slideFiles) {
    const slideNum = Number(/slide(\d+)\.xml$/.exec(filename)?.[1] ?? 0);
    if (!slideNum) continue;
    const relsEntry = zip.files[`ppt/slides/_rels/slide${slideNum}.xml.rels`];
    if (!relsEntry) continue;
    const [slideXml, relsXml] = await Promise.all([
      zip.files[filename].async('text'),
      relsEntry.async('text'),
    ]);
    const targetByRid = parsePptxImageRelTargets(relsXml, filename);
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
      const imageBuffer = await zip.files[mediaPath].async('nodebuffer');
      if (!imageBuffer.length) continue;
      const list = result.bySlide.get(slideNum) ?? [];
      list.push({
        placement: `slide-${slideNum}`,
        position: slideNum,
        buffer: imageBuffer,
        mimeType: media.mimeType,
        filename: media.filename,
      });
      result.bySlide.set(slideNum, list);
      collected += 1;
    }
  }

  for (const [mediaPath, media] of mediaByPath) {
    if (attributed.has(mediaPath)) continue;
    if (collected >= maxCount) {
      truncated += 1;
      continue;
    }
    const imageBuffer = await zip.files[mediaPath].async('nodebuffer');
    if (!imageBuffer.length) continue;
    result.unattributed.push({
      placement: 'misc',
      position: 0,
      buffer: imageBuffer,
      mimeType: media.mimeType,
      filename: media.filename,
    });
    collected += 1;
  }
  if (truncated > 0) {
    result.warnings.push({
      code: 'pptx_image_limit_reached',
      message: `PPTX 图片提取达到 ${maxCount} 张上限，另有 ${truncated} 张未读取。`,
    });
  }
  return result;
}

/** 解析 slide rels：rId → ppt/media/xxx，只取 image 类型关系。 */
export function parsePptxImageRelTargets(
  relsXml: string,
  sourcePath = 'ppt/slides/slide1.xml',
): Map<string, string> {
  const targets = new Map<string, string>();
  for (const [id, relation] of parseRelationships(relsXml, sourcePath)) {
    if (!relation.type.endsWith('/image')) continue;
    targets.set(id, relation.target);
  }
  return targets;
}

/** 取小写扩展名（无扩展名返回空串）。 */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** 从 PPTX shape XML 中按段落顺序读取文字及项目符号。 */
export function extractPptxTextBlocks(xml: string): string[] {
  return [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)]
    .map((paragraph) => {
      const text = [
        ...paragraph[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g),
      ]
        .map((match) => decodeXmlEntities(match[1]).trim())
        .filter(Boolean)
        .join('');
      const bullet = /<a:bu(?:Char|AutoNum|Blip)\b/.test(paragraph[1]);
      return text ? `${bullet ? '- ' : ''}${text}` : '';
    })
    .filter(Boolean);
}

function parseMammothHtml(
  html: string,
  warnings: ParsedDocumentWarning[],
): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const headingPath: string[] = [];
  const pattern =
    /<(h[1-6]|p|table)\b[^>]*>[\s\S]*?<\/\1>|<img\b[^>]*\/?\s*>/gi;
  let imageIndex = 0;
  for (const match of html.matchAll(pattern)) {
    const sourceStart = match.index ?? 0;
    const sourceEnd = sourceStart + match[0].length;
    const tag = /^<([a-z0-9]+)/i.exec(match[0])?.[1]?.toLowerCase();
    if (!tag) continue;
    if (/^h[1-6]$/.test(tag)) {
      const text = stripHtml(match[0].replace(/^<[^>]+>|<\/[^>]+>$/g, ''));
      if (!text) continue;
      const level = Number(tag.slice(1));
      headingPath.splice(level - 1);
      headingPath[level - 1] = text;
      blocks.push({
        type: 'heading',
        text,
        level,
        headingPath: [...headingPath],
        sourceStart,
        sourceEnd,
      });
    } else if (tag === 'p') {
      const paragraphHtml = match[0].replace(/^<[^>]+>|<\/[^>]+>$/g, '');
      const images = [...paragraphHtml.matchAll(/<img\b[^>]*\/?\s*>/gi)];
      if (images.length === 0) {
        const text = stripHtml(paragraphHtml);
        if (text)
          blocks.push({
            type: 'paragraph',
            text,
            headingPath: headingPath.filter(Boolean),
            sourceStart,
            sourceEnd,
          });
      } else {
        let cursor = 0;
        for (const image of images) {
          const imageStart = image.index ?? cursor;
          const before = stripHtml(paragraphHtml.slice(cursor, imageStart));
          if (before)
            blocks.push({
              type: 'paragraph',
              text: before,
              headingPath: headingPath.filter(Boolean),
              sourceStart: sourceStart + cursor,
              sourceEnd: sourceStart + imageStart,
            });
          appendDocxImageBlock(
            blocks,
            warnings,
            image[0],
            headingPath,
            sourceStart + imageStart,
            sourceStart + imageStart + image[0].length,
            imageIndex,
          );
          imageIndex += 1;
          cursor = imageStart + image[0].length;
        }
        const after = stripHtml(paragraphHtml.slice(cursor));
        if (after)
          blocks.push({
            type: 'paragraph',
            text: after,
            headingPath: headingPath.filter(Boolean),
            sourceStart: sourceStart + cursor,
            sourceEnd,
          });
      }
    } else if (tag === 'table') {
      const table = parseHtmlTable(match[0]);
      if (table.text) {
        blocks.push({
          type: 'table',
          text: table.text,
          metadata: { rows: table.rows, columns: table.columns },
          headingPath: headingPath.filter(Boolean),
          sourceStart,
          sourceEnd,
        });
      }
    } else if (tag === 'img') {
      appendDocxImageBlock(
        blocks,
        warnings,
        match[0],
        headingPath,
        sourceStart,
        sourceEnd,
        imageIndex,
      );
      imageIndex += 1;
    }
  }
  return blocks;
}

function appendDocxImageBlock(
  blocks: ParsedBlock[],
  warnings: ParsedDocumentWarning[],
  imageHtml: string,
  headingPath: string[],
  sourceStart: number,
  sourceEnd: number,
  imageIndex: number,
): void {
  const attributes = parseHtmlAttributes(imageHtml);
  const alt = decodeXmlEntities(attributes.alt ?? '').trim();
  const mimeType = /^data:([^;,]+)/i.exec(attributes.src ?? '')?.[1];
  blocks.push({
    type: 'image',
    text: alt ? `![${alt}]` : '',
    asset: { alt, ...(mimeType ? { mimeType } : {}) },
    metadata: { embeddedImageIndex: imageIndex + 1, hasAltText: Boolean(alt) },
    headingPath: headingPath.filter(Boolean),
    sourceStart,
    sourceEnd,
  });
  warnings.push({
    code: 'docx_image_not_materialized',
    message: alt
      ? `DOCX 包含内嵌图片“${alt}”；已保留图片位置和说明，图片字节仍保存在原文件中。`
      : 'DOCX 包含没有替代文本的内嵌图片；已保留图片位置，图片字节仍保存在原文件中。',
  });
}

function mammothWarnings(
  messages: Array<{ type: string; message: string }>,
): ParsedDocumentWarning[] {
  return messages.map((message) => ({
    code: `mammoth_${message.type || 'warning'}`,
    message: message.message,
  }));
}

function parseHtmlTable(html: string): {
  text: string;
  rows: number;
  columns: number;
} {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      stripHtml(cell[1]),
    ),
  );
  return {
    text: rowsToMarkdown(rows),
    rows: rows.length,
    columns: rows.reduce((max, row) => Math.max(max, row.length), 0),
  };
}

function parsePptxTable(xml: string): {
  text: string;
  rows: number;
  columns: number;
} {
  const rows = [...xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map(
    (row) =>
      [...row[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((cell) =>
        extractPptxTextBlocks(cell[1]).join(' ').trim(),
      ),
  );
  return {
    text: rowsToMarkdown(rows),
    rows: rows.length,
    columns: rows.reduce((max, row) => Math.max(max, row.length), 0),
  };
}

function rowsToMarkdown(rows: string[][]): string {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (!width || !rows.some((row) => row.some((cell) => cell.trim()))) return '';
  const padded = rows.map((row) =>
    Array.from({ length: width }, (_, index) => markdownCell(row[index] ?? '')),
  );
  const header = padded[0].map((value, index) => value || `列${index + 1}`);
  const body = padded.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function markdownCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
}

function extractPptxChartData(xml: string): {
  text: string;
  seriesCount: number;
  pointCount: number;
} {
  const titleXml = /<c:title\b[\s\S]*?<\/c:title>/.exec(xml)?.[0] ?? '';
  const title = [...titleXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXmlEntities(match[1]).trim())
    .filter(Boolean)
    .join(' ');
  const series = [...xml.matchAll(/<c:ser\b[^>]*>([\s\S]*?)<\/c:ser>/g)].map(
    (match, index) => {
      const body = match[1];
      const nameXml = /<c:tx\b[\s\S]*?<\/c:tx>/.exec(body)?.[0] ?? '';
      const name = extractChartValues(nameXml)[0]?.value || `系列 ${index + 1}`;
      const categoryXml = /<c:cat\b[\s\S]*?<\/c:cat>/.exec(body)?.[0] ?? '';
      const valueXml = /<c:val\b[\s\S]*?<\/c:val>/.exec(body)?.[0] ?? '';
      return {
        name,
        categories: extractChartValues(categoryXml),
        values: extractChartValues(valueXml),
      };
    },
  );
  const pointCount = series.reduce(
    (sum, item) => sum + Math.max(item.categories.length, item.values.length),
    0,
  );
  const lines: string[] = [];
  if (title) lines.push(`图表标题：${title}`);
  if (series.some((item) => item.values.length)) {
    lines.push('| 类别 | 系列 | 数值 |', '| --- | --- | --- |');
    for (const item of series) {
      const count = Math.max(item.categories.length, item.values.length);
      for (let index = 0; index < count; index += 1) {
        lines.push(
          `| ${markdownCell(item.categories[index]?.value ?? `项目 ${index + 1}`)} | ${markdownCell(item.name)} | ${markdownCell(item.values[index]?.value ?? '')} |`,
        );
      }
    }
  }
  if (lines.length === 0) {
    const text = [...xml.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)]
      .map((match) => decodeXmlEntities(match[1]).trim())
      .filter(Boolean);
    if (text.length) lines.push(text.join(' · '));
  }
  return { text: lines.join('\n'), seriesCount: series.length, pointCount };
}

function extractChartValues(
  xml: string,
): Array<{ index: number; value: string }> {
  return [...xml.matchAll(/<c:pt\b[^>]*\bidx="(\d+)"[^>]*>([\s\S]*?)<\/c:pt>/g)]
    .map((point) => ({
      index: Number(point[1]),
      value: decodeXmlEntities(
        /<c:v>([\s\S]*?)<\/c:v>/.exec(point[2])?.[1] ?? '',
      ).trim(),
    }))
    .filter((point) => point.value)
    .sort((a, b) => a.index - b.index)
    .map(({ value, index }) => ({ value, index }));
}

function parsePptxImageBlock(
  shape: string,
  relations: Map<string, { target: string; type: string }>,
  slideNumber: number,
  uploaded: UploadedEmbeddedImage | undefined,
  imageIndex: number,
): ParsedBlock | null {
  const properties = /<p:cNvPr\b[^>]*\/>/.exec(shape)?.[0] ?? '';
  const attrs = parseHtmlAttributes(properties.replace(/^<p:cNvPr/, '<img'));
  const relId = /\br:embed="([^"]+)"/.exec(shape)?.[1];
  const relation = relId ? relations.get(relId) : undefined;
  const alt = decodeXmlEntities(attrs.descr || uploaded?.alt || '').trim();
  const mimeType = relation
    ? IMAGE_MIME_BY_EXTENSION[extensionOf(relation.target)]
    : undefined;
  return {
    type: 'image',
    text: alt ? `![${alt}]${uploaded?.url ? `(${uploaded.url})` : ''}` : '',
    slideNumber,
    asset: {
      ...(uploaded?.url ? { url: uploaded.url } : {}),
      ...(mimeType ? { mimeType } : {}),
      alt,
    },
    metadata: {
      imageIndex,
      hasAltText: Boolean(alt),
      ...(relation ? { sourcePart: relation.target } : {}),
    },
  };
}

function parseRelationships(
  xml: string,
  sourcePath: string,
): Map<string, { target: string; type: string }> {
  const relations = new Map<string, { target: string; type: string }>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const attrs = parseHtmlAttributes(
      match[0].replace(/^<Relationship/, '<img'),
    );
    const id = attrs.id;
    const target = attrs.target;
    const type = attrs.type;
    if (!id || !target || !type || attrs.targetmode === 'External') continue;
    relations.set(id, { target: resolveZipTarget(sourcePath, target), type });
  }
  return relations;
}

function resolveZipTarget(sourcePath: string, target: string): string {
  if (target.startsWith('/'))
    return posix.normalize(target).replace(/^\/+/, '');
  return posix.normalize(posix.join(posix.dirname(sourcePath), target));
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    attributes[match[1].toLowerCase()] = decodeXmlEntities(match[3]);
  }
  return attributes;
}

function stripHtml(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function assertOoxmlPackage(
  zip: JSZip,
  kind: 'docx' | 'xlsx' | 'pptx',
): Promise<void> {
  if (!zip.files['[Content_Types].xml']) {
    throw new Error('OOXML package is missing [Content_Types].xml.');
  }
  const requiredPart =
    kind === 'docx'
      ? 'word/document.xml'
      : kind === 'xlsx'
        ? 'xl/workbook.xml'
        : 'ppt/presentation.xml';
  if (!zip.files[requiredPart]) {
    throw new Error(`OOXML package is missing ${requiredPart}.`);
  }
  const contentTypes = await zip.files['[Content_Types].xml'].async('text');
  const expectedPart = requiredPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`PartName="/${expectedPart}"`).test(contentTypes)) {
    throw new Error(`OOXML content types do not declare ${requiredPart}.`);
  }
}

function assertZipSignature(buffer: Buffer, kind: 'xlsx'): void {
  if (!isZipBuffer(buffer))
    throw new Error(`${kind.toUpperCase()} is not a ZIP-based OOXML file.`);
}

function assertOleSignature(buffer: Buffer, kind: 'xls'): void {
  const oleSignature = Buffer.from('d0cf11e0a1b11ae1', 'hex');
  if (
    buffer.length < oleSignature.length ||
    !buffer.subarray(0, 8).equals(oleSignature)
  ) {
    throw new Error(
      `${kind.toUpperCase()} does not have a valid OLE compound-file signature.`,
    );
  }
}

function isZipBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [
      [0x03, 0x04],
      [0x05, 0x06],
      [0x07, 0x08],
    ].some(([third, fourth]) => buffer[2] === third && buffer[3] === fourth)
  );
}

function createParsedDocument(
  kind: SupportedDocumentKind,
  title: string,
  blocks: ParsedBlock[],
  warnings: ParsedDocumentWarning[],
): ParsedDocument {
  const meaningfulBlocks = blocks.filter(
    (block) => block.text.trim() && block.metadata?.structuralOnly !== true,
  );
  if (meaningfulBlocks.length === 0) {
    warnings.push({
      code: 'document_content_empty',
      message: '未从文件中提取到可索引正文。',
    });
    return {
      kind,
      title,
      blocks: [],
      markdown: '',
      status: 'failed',
      completeness: 0,
      warnings,
    };
  }
  const status = warnings.length > 0 ? 'partial' : 'complete';
  const completeness =
    status === 'complete'
      ? 1
      : meaningfulBlocks.length / (meaningfulBlocks.length + warnings.length);
  return {
    kind,
    title,
    blocks: blocks.filter(
      (block) => block.text.trim() || block.type === 'image',
    ),
    markdown: renderParsedMarkdown(
      title,
      blocks.filter((block) => block.text.trim()),
    ),
    status,
    completeness,
    warnings,
  };
}

function failedDocument(
  kind: SupportedDocumentKind,
  title: string,
  code: string,
  error: unknown,
  warnings: ParsedDocumentWarning[] = [],
): ParsedDocument {
  return {
    kind,
    title,
    blocks: [],
    markdown: '',
    status: 'failed',
    completeness: 0,
    warnings: [...warnings, { code, message: errorMessage(error) }],
  };
}

function renderParsedMarkdown(title: string, blocks: ParsedBlock[]): string {
  const body = blocks
    .map((block) => {
      if (block.sheetName) return `## ${block.sheetName}\n\n${block.text}`;
      if (block.type === 'heading') {
        return `${'#'.repeat(Math.min(6, Math.max(1, block.level ?? 2)))} ${block.text}`;
      }
      return block.text;
    })
    .filter(Boolean);
  return [`# ${title}`, ...body].join('\n\n').trim();
}

function markdownOrThrow(document: ParsedDocument): string {
  if (document.status === 'failed' || !document.markdown.trim()) {
    const message = document.warnings
      .map((warning) => warning.message)
      .filter(Boolean)
      .join('; ');
    throw new BadRequestException(
      message || `${document.title} parsing failed.`,
    );
  }
  return document.markdown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
