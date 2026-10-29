import { Metadata } from '@grpc/grpc-js';
import { RagGrpcController } from './rag-grpc.controller';

describe('RagGrpcController authentication', () => {
  it('uses the authenticated bearer identity instead of request user_id', async () => {
    const rag = { retrieve: jest.fn().mockResolvedValue([]) };
    const controller = new RagGrpcController(
      rag as never,
      {} as never,
      {
        verifyToken: jest.fn().mockResolvedValue({
          userId: 'authenticated-owner',
          username: 'owner',
          role: 'user',
        }),
      } as never,
      { verifyApiToken: jest.fn() } as never,
      { get: jest.fn().mockReturnValue(false) } as never,
      { hasPermission: jest.fn() } as never,
    );
    const metadata = new Metadata();
    metadata.set('authorization', 'Bearer valid-token');

    await controller.vectorSearch(
      { query: 'hello', user_id: 'attacker', top_k: 5, mode: 'simple' },
      metadata,
    );

    expect(rag.retrieve).toHaveBeenCalledWith(
      'hello',
      { vectorSearch: true },
      'authenticated-owner',
    );
  });

  it('rejects gRPC calls without bearer metadata', async () => {
    const authService = { verifyToken: jest.fn() };
    const controller = new RagGrpcController(
      { retrieve: jest.fn() } as never,
      {} as never,
      authService as never,
      { verifyApiToken: jest.fn() } as never,
      { get: jest.fn().mockReturnValue(false) } as never,
      { hasPermission: jest.fn() } as never,
    );

    await expect(
      controller.vectorSearch(
        { query: 'hello', user_id: 'attacker', top_k: 5, mode: 'simple' },
        new Metadata(),
      ),
    ).rejects.toThrow('missing bearer token');
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });
});
