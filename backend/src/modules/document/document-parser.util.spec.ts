import { BadRequestException } from '@nestjs/common';
import { extractUrlContent } from './document-parser.util';

describe('document URL extraction safety', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'http://service.internal/config',
  ])('rejects private or local target %s before fetching', async (url) => {
    await expect(extractUrlContent(url)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects non-http protocols before DNS resolution', async () => {
    await expect(extractUrlContent('file:///etc/passwd')).rejects.toThrow(
      'only http and https urls are supported',
    );
  });
});
