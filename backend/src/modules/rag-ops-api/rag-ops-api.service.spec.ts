import { RagOpsApiService } from './rag-ops-api.service';

describe('RagOpsApiService reindex', () => {
  it('delegates to RagAdminService without deleting or recreating the document', async () => {
    const reindexDocument = jest.fn().mockResolvedValue({
      docId: 'doc-1',
      reindexed: true,
      chunkCount: 2,
    });
    const deleteDocument = jest.fn();
    const service = Object.create(
      RagOpsApiService.prototype,
    ) as RagOpsApiService;
    Object.assign(service, {
      ragAdminService: { reindexDocument },
      documentService: { delete: deleteDocument, upload: jest.fn() },
    });

    await expect(service.reindexDocument('doc-1')).resolves.toEqual({
      docId: 'doc-1',
      reindexed: true,
      chunkCount: 2,
    });

    expect(reindexDocument).toHaveBeenCalledWith('doc-1');
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});
