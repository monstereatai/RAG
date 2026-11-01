import JSZip from 'jszip';
import { validateDocumentFormat } from './document-parser.validation';

describe('document format validation', () => {
  it('requires a PDF signature even when the filename ends in .pdf', async () => {
    await expect(
      validateDocumentFormat(Buffer.from('not a pdf'), 'pdf', 'report.pdf'),
    ).rejects.toThrow('does not match the declared pdf format');
  });

  it('checks OOXML main parts instead of accepting any ZIP as DOCX', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types></Types>');
    zip.file('ppt/presentation.xml', '<p:presentation/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(
      validateDocumentFormat(buffer, 'docx', 'report.docx'),
    ).rejects.toThrow('does not match the declared docx format');
  });

  it('accepts a correctly signed minimal DOCX package', async () => {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file('word/document.xml', '<w:document xmlns:w="x"></w:document>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(
      validateDocumentFormat(buffer, 'docx', 'report.docx'),
    ).resolves.toBeUndefined();
  });

  it('rejects a corrupt or empty container', async () => {
    await expect(
      validateDocumentFormat(Buffer.alloc(0), 'xlsx', 'sheet.xlsx'),
    ).rejects.toThrow('uploaded file is empty');
    await expect(
      validateDocumentFormat(Buffer.from('broken zip'), 'xlsx', 'sheet.xlsx'),
    ).rejects.toThrow('does not match the declared xlsx format');
  });
});
