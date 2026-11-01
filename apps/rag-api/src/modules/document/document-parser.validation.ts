import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import type { SupportedDocumentKind } from './document-parser.types';

const OLE_COMPOUND_FILE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');

const OOXML_MAIN_PARTS: Partial<Record<SupportedDocumentKind, string>> = {
  docx: 'word/document.xml',
  pptx: 'ppt/presentation.xml',
  xlsx: 'xl/workbook.xml',
};
const OOXML_MAIN_CONTENT_TYPES: Partial<Record<SupportedDocumentKind, string>> =
  {
    docx: 'wordprocessingml.document.main+xml',
    pptx: 'presentationml.presentation.main+xml',
    xlsx: 'spreadsheetml.sheet.main+xml',
  };

/** 根据文件内容校验扩展名对应的容器，不能只相信客户端文件名或 MIME。 */
export async function validateDocumentFormat(
  buffer: Buffer,
  kind: SupportedDocumentKind,
  filename: string,
): Promise<void> {
  if (buffer.length === 0) {
    throw new BadRequestException('uploaded file is empty');
  }

  const mainPart = OOXML_MAIN_PARTS[kind];
  if (mainPart) {
    await validateOoxml(buffer, kind, filename, mainPart);
    return;
  }

  if (kind === 'pdf') {
    const header = buffer.subarray(0, Math.min(buffer.length, 1024));
    if (header.indexOf('%PDF-') < 0) {
      throw formatMismatch(filename, kind);
    }
    return;
  }

  if (kind === 'xls' || kind === 'doc' || kind === 'ppt') {
    if (
      !buffer
        .subarray(0, OLE_COMPOUND_FILE_SIGNATURE.length)
        .equals(OLE_COMPOUND_FILE_SIGNATURE)
    ) {
      throw formatMismatch(filename, kind);
    }
    return;
  }

  if (kind === 'image') {
    validateImageSignature(buffer, filename);
  }
}

async function validateOoxml(
  buffer: Buffer,
  kind: SupportedDocumentKind,
  filename: string,
  mainPart: string,
): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw formatMismatch(filename, kind);
  }

  const contentTypes = zip.file('[Content_Types].xml');
  const part = zip.file(mainPart);
  if (!contentTypes || !part) {
    throw formatMismatch(filename, kind);
  }

  const contentTypesXml = await contentTypes.async('text');
  const mainPartXml = await part.async('text');
  const expectedRoot: Record<string, RegExp> = {
    docx: /<w:document(?:\s|>)/,
    pptx: /<p:presentation(?:\s|>)/,
    xlsx: /<workbook(?:\s|>)/,
  };
  if (
    !/<Types(?:\s|>)/.test(contentTypesXml) ||
    !contentTypesXml.includes(OOXML_MAIN_CONTENT_TYPES[kind] ?? '') ||
    !expectedRoot[kind]?.test(mainPartXml)
  ) {
    throw formatMismatch(filename, kind);
  }
}

function validateImageSignature(buffer: Buffer, filename: string): void {
  const extension = filename.split('.').pop()?.toLowerCase();
  const valid = (() => {
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return (
          buffer.length >= 3 &&
          buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        );
      case 'png':
        return buffer
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
      case 'gif':
        return (
          buffer
            .subarray(0, 6)
            .toString('ascii')
            .match(/^GIF8[79]a$/) !== null
        );
      case 'webp':
        return (
          buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
          buffer.subarray(8, 12).toString('ascii') === 'WEBP'
        );
      case 'bmp':
        return buffer.subarray(0, 2).toString('ascii') === 'BM';
      default:
        return false;
    }
  })();

  if (!valid) {
    throw formatMismatch(filename, 'image');
  }
}

function formatMismatch(filename: string, kind: string): BadRequestException {
  return new BadRequestException(
    `file content does not match the declared ${kind} format: ${filename}`,
  );
}
