import { PublicArtifactsController } from './public-artifacts.controller';

describe('PublicArtifactsController preview headers', () => {
  function createController(contentType: string) {
    const artifacts = {
      getSharedPreviewFile: jest.fn().mockResolvedValue({
        artifact: {
          filename: 'preview.html',
          contentType,
        },
        body: Buffer.from('<script>alert(1)</script>'),
      }),
    };
    return new PublicArtifactsController(artifacts as never);
  }

  it('isolates shared HTML previews from the application origin', async () => {
    const controller = createController('text/html; charset=utf-8');
    const headers = new Map<string, string>();
    const response = {
      setHeader: jest.fn((name: string, value: string) =>
        headers.set(name, value),
      ),
      send: jest.fn(),
    };

    await controller.preview(
      'share-token',
      { headers: {}, ip: '127.0.0.1' } as never,
      response as never,
    );

    expect(headers.get('Content-Security-Policy')).toContain('sandbox;');
    expect(headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    );
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Content-Disposition')).toContain('inline;');
    expect(response.send).toHaveBeenCalled();
  });

  it('does not apply HTML sandbox policy to PDFs but prevents MIME sniffing', async () => {
    const controller = createController('application/pdf');
    const headers = new Map<string, string>();
    const response = {
      setHeader: jest.fn((name: string, value: string) =>
        headers.set(name, value),
      ),
      send: jest.fn(),
    };

    await controller.preview(
      'share-token',
      { headers: {}, ip: '127.0.0.1' } as never,
      response as never,
    );

    expect(headers.has('Content-Security-Policy')).toBe(false);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
