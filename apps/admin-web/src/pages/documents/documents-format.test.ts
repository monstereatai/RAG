import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import {
  formatDocumentDateTime,
  restoreLegacyFilenameEncoding,
} from './documents-format';

describe('document display formatting', () => {
  it('repairs legacy UTF-8 filenames decoded as Latin-1', () => {
    const filename = '1开悟其实很简单 — 人人都可以轻轻-松松开悟.pdf';
    const mojibake = Buffer.from(filename, 'utf8').toString('latin1');

    expect(restoreLegacyFilenameEncoding(mojibake)).toBe(filename);
  });

  it('preserves ordinary ASCII filenames', () => {
    expect(restoreLegacyFilenameEncoding('report-2026.pdf')).toBe(
      'report-2026.pdf',
    );
  });

  it('formats valid upload dates and handles missing or invalid values', () => {
    const value = '2026-11-01T02:27:10.134Z';
    expect(formatDocumentDateTime(value)).toBe(
      dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
    );
    expect(formatDocumentDateTime('not-a-date')).toBe('—');
    expect(formatDocumentDateTime(null)).toBe('—');
  });
});
