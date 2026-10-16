import { HttpException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AdminImagesController } from './admin-images.controller';

describe('AdminImagesController', () => {
  const ragClient = {
    searchImages: jest.fn(),
    searchImagesByImage: jest.fn(),
    getImageAsset: jest.fn(),
  };
  const controller = new AdminImagesController(ragClient as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('derives user, tenant and role from the authenticated request and proxies only RAG asset URLs', async () => {
    ragClient.searchImages.mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          query: 'chart',
          limit: 5,
          reason: null,
          results: [
            {
              docId: 'doc-1',
              url: '/api/v1/documents/assets/image?key=documents%2Fowner-1%2Fdoc-1%2Fimages%2Fpage-1.png',
              score: 0.91,
            },
            {
              docId: 'doc-2',
              url: 'https://attacker.example/image.png',
              score: 0.8,
            },
          ],
        },
      },
    });
    const req = {
      user: { userId: 'user-1', tenantId: 'tenant-a', role: 'editor' },
      query: { userId: 'attacker', tenantId: 'tenant-b' },
    };

    await expect(controller.search('chart', '5', req as never)).resolves.toEqual({
      query: 'chart',
      limit: 5,
      reason: null,
      results: [
        {
          docId: 'doc-1',
          url: '/api/admin/images/asset?docId=doc-1&key=documents%2Fowner-1%2Fdoc-1%2Fimages%2Fpage-1.png',
          score: 0.91,
        },
        { docId: 'doc-2', url: '', score: 0.8 },
      ],
    });
    expect(ragClient.searchImages).toHaveBeenCalledWith(
      'user-1',
      'tenant-a',
      'editor',
      'chart',
      5,
    );
  });

  it('rejects image search without authenticated identity', async () => {
    await expect(controller.search('chart', '5', {} as never)).rejects.toThrow(HttpException);
    expect(ragClient.searchImages).not.toHaveBeenCalled();
  });

  it('forwards uploaded images with authenticated scope and proxies result URLs', async () => {
    ragClient.searchImagesByImage.mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          query: '上传图片',
          limit: 5,
          reason: null,
          results: [
            {
              docId: 'doc-1',
              url: '/api/v1/documents/assets/image?key=documents%2Fowner-1%2Fdoc-1%2Fimages%2Fpage-1.png',
              score: 0.91,
            },
          ],
        },
      },
    });
    const file = {
      buffer: Buffer.from('png-data'),
      mimetype: 'image/png',
      originalname: 'query.png',
    } as Express.Multer.File;
    const req = {
      user: { userId: 'user-1', tenantId: 'tenant-a', role: 'editor' },
      body: { userId: 'attacker', tenantId: 'tenant-b' },
    };

    await expect(controller.searchByImage(file, '5', req as never)).resolves.toEqual({
      query: '上传图片',
      limit: 5,
      reason: null,
      results: [
        {
          docId: 'doc-1',
          url: '/api/admin/images/asset?docId=doc-1&key=documents%2Fowner-1%2Fdoc-1%2Fimages%2Fpage-1.png',
          score: 0.91,
        },
      ],
    });
    expect(ragClient.searchImagesByImage).toHaveBeenCalledWith(
      'user-1',
      'tenant-a',
      'editor',
      file,
      5,
    );
  });

  it('rejects non-image uploads and requires document read permission', async () => {
    await expect(
      controller.searchByImage(
        { buffer: Buffer.from('text'), mimetype: 'text/plain' } as Express.Multer.File,
        undefined,
        { user: { userId: 'user-1' } } as never,
      ),
    ).rejects.toThrow('只支持图片文件');
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.searchByImage),
    ).toEqual(['admin:documents:read']);
    expect(ragClient.searchImagesByImage).not.toHaveBeenCalled();
  });

  it('proxies image bytes using the authenticated identity, never browser-supplied identity', async () => {
    ragClient.getImageAsset.mockResolvedValue(
      new Response(Buffer.from('png-data'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    const req = {
      user: { sub: 7, tenantId: 'tenant-a', role: 'admin' },
      query: { userId: 'attacker', tenantId: 'tenant-b' },
    };

    await controller.getAsset(
      'doc-1',
      'documents/owner-1/doc-1/images/page-1.png',
      req as never,
      response as never,
    );

    expect(ragClient.getImageAsset).toHaveBeenCalledWith(
      '7',
      'tenant-a',
      'admin',
      'doc-1',
      'documents/owner-1/doc-1/images/page-1.png',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.send).toHaveBeenCalledWith(Buffer.from('png-data'));
  });

  it('requires document read permission for both search and asset proxy routes', () => {
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.search),
    ).toEqual(['admin:documents:read']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.getAsset),
    ).toEqual(['admin:documents:read']);
  });
});
