import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import type {
  ParsedDocument,
  ParsedDocumentWarning,
} from './document-parser.types';
import {
  getCodeLanguage,
  isSafeCodePath,
  MAX_CODE_FILE_BYTES,
} from './code-language.util';
import { parseCodeSource } from './code-parser.util';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 24 * 1024 * 1024;
const MAX_SOURCE_FILES = 1200;

/** ZIP is only a transport container, never an executable project. */
export async function parseCodeArchive(
  buffer: Buffer,
  filename: string,
): Promise<ParsedDocument> {
  if (
    !buffer.length ||
    buffer.length > MAX_ARCHIVE_BYTES ||
    !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    throw new BadRequestException('invalid or oversized source ZIP');
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new BadRequestException('invalid ZIP archive');
  }
  const paths = Object.keys(zip.files).sort();
  if (paths.length > MAX_SOURCE_FILES * 5) {
    throw new BadRequestException('ZIP has too many entries');
  }
  const candidates = paths.filter((path) => {
    const entry = zip.files[path];
    return !entry.dir && isSafeCodePath(path) && getCodeLanguage(path) !== null;
  });
  if (!candidates.length)
    throw new BadRequestException('ZIP contains no supported source files');
  if (candidates.length > MAX_SOURCE_FILES)
    throw new BadRequestException('too many source files in ZIP');

  let extracted = 0;
  let parsedFiles = 0;
  const blocks: ParsedDocument['blocks'] = [];
  const warnings: ParsedDocumentWarning[] = [];
  for (const path of candidates) {
    const entry = zip.files[path];
    const sizes = (
      entry as unknown as {
        _data?: { uncompressedSize?: number; compressedSize?: number };
      }
    )._data;
    const reportedSize = sizes?.uncompressedSize;
    if (
      !Number.isSafeInteger(reportedSize) ||
      reportedSize === undefined ||
      reportedSize < 0
    ) {
      throw new BadRequestException(`ZIP entry size unavailable: ${path}`);
    }
    if (
      reportedSize > MAX_CODE_FILE_BYTES ||
      extracted + reportedSize > MAX_EXTRACTED_BYTES ||
      (reportedSize > 4096 &&
        reportedSize / Math.max(1, sizes?.compressedSize ?? 0) > 200)
    ) {
      warnings.push({
        code: 'code_zip_file_too_large',
        message: `Skipped oversized entry: ${path}`,
      });
      continue;
    }
    // Refuse zip entries with a suspicious original name even when JSZip has sanitized it.
    const unsafeOriginalName = (
      entry as unknown as { unsafeOriginalName?: string }
    ).unsafeOriginalName;
    if (unsafeOriginalName && !isSafeCodePath(unsafeOriginalName)) {
      warnings.push({
        code: 'code_zip_unsafe_path',
        message: `Skipped unsafe entry: ${path}`,
      });
      continue;
    }
    const data = await entry.async('nodebuffer');
    extracted += data.length;
    if (data.length > MAX_CODE_FILE_BYTES || extracted > MAX_EXTRACTED_BYTES) {
      throw new BadRequestException('extracted ZIP source exceeds size limits');
    }
    try {
      const doc = parseCodeSource(data, path);
      if (doc.status === 'failed') continue;
      blocks.push(...doc.blocks);
      parsedFiles++;
      warnings.push(
        ...doc.warnings.slice(0, 5).map((warning) => ({
          ...warning,
          message: `${path}: ${warning.message}`,
        })),
      );
    } catch (error) {
      warnings.push({
        code: 'code_zip_parse_failed',
        message: `Skipped ${path}: ${String(error)}`,
      });
    }
  }
  if (!blocks.length)
    throw new BadRequestException('no source files in ZIP could be parsed');
  const completeness = parsedFiles / candidates.length;
  return {
    kind: 'code_archive',
    title: filename,
    blocks,
    // Heading metadata remains readable to Obsidian; structured blocks drive actual chunking.
    markdown: blocks
      .map((block) => {
        const m = block.metadata ?? {};
        return `## ${m.filePath} :: ${m.symbol} (L${m.startLine}-${m.endLine})\n\n\`\`\`\`\n${block.text}\n\`\`\`\``;
      })
      .join('\n\n'),
    status: warnings.length ? 'partial' : 'complete',
    completeness,
    warnings: warnings.slice(0, 60),
  };
}
