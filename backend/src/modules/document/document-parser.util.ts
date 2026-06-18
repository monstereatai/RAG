import { BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export type SupportedDocumentKind = 'markdown' | 'text' | 'pdf' | 'docx';

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

  throw new BadRequestException(
    'only .md / .markdown / .txt / .pdf / .docx files are supported',
  );
}

export async function extractDocumentText(
  buffer: Buffer,
  kind: SupportedDocumentKind,
): Promise<string> {
  switch (kind) {
    case 'markdown':
    case 'text':
      return buffer.toString('utf-8');
    case 'pdf':
      return extractPdfText(buffer);
    case 'docx':
      return extractDocxText(buffer);
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
