import { createHash } from 'node:crypto';
import { KarpathyObsidianIngestService } from './karpathy-obsidian-ingest.service';
import type { ObsidianNoteIngestProcessor } from './document-queue.service';

describe('KarpathyObsidianIngestService', () => {
  const rag = { docId: 'doc-1', chunkCount: 2 };
  let documentService: { upload: jest.Mock; hasDoc: jest.Mock };
  let obsidianKnowledge: {
    findSourceByContentHash: jest.Mock;
    writeSource: jest.Mock;
  };
  let documentQueue: {
    registerObsidianNoteProcessor: jest.Mock;
    enqueueObsidianNote: jest.Mock;
  };
  let documentChunkRepo: { find: jest.Mock };
  let service: KarpathyObsidianIngestService;
  let processor: ObsidianNoteIngestProcessor | undefined;

  beforeEach(() => {
    processor = undefined;
    documentService = {
      upload: jest.fn().mockResolvedValue(rag),
      hasDoc: jest.fn().mockResolvedValue(false),
    };
    obsidianKnowledge = {
      findSourceByContentHash: jest.fn().mockResolvedValue(null),
      writeSource: jest.fn().mockResolvedValue({ status: 'saved' }),
    };
    documentQueue = {
      registerObsidianNoteProcessor: jest.fn(
        (value: ObsidianNoteIngestProcessor) => {
          processor = value;
        },
      ),
      enqueueObsidianNote: jest.fn().mockResolvedValue({
        status: 'queued',
        taskId: 'obsidian-doc-1',
      }),
    };
    documentChunkRepo = { find: jest.fn().mockResolvedValue([]) };
    service = new KarpathyObsidianIngestService(
      documentService as never,
      obsidianKnowledge as never,
      documentQueue as never,
      documentChunkRepo as never,
    );
  });

  it('queues note organization after RAG upload and does not write the note inline', async () => {
    const result = await service.ingestText({
      title: 'Guide',
      content: '# Guide\n\nOriginal content',
      userId: 'user-1',
      filename: 'guide.md',
      sourceType: 'document',
    });

    const uploadCall = documentService.upload.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(uploadCall.slice(0, 3)).toEqual([
      'guide.md',
      '# Guide\n\nOriginal content',
      'user-1',
    ]);
    expect(uploadCall[3].onQualityAccepted).toBeUndefined();
    expect(documentQueue.enqueueObsidianNote).toHaveBeenCalledWith({
      docId: 'doc-1',
      userId: 'user-1',
      title: 'Guide',
      contentHash: createHash('sha256')
        .update('# Guide\n\nOriginal content')
        .digest('hex'),
      sourceUrl: undefined,
      sourceType: 'document',
      contentType: undefined,
      filename: 'guide.md',
    });
    expect(obsidianKnowledge.writeSource).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      rag,
      obsidian: { status: 'queued', taskId: 'obsidian-doc-1' },
    });
  });

  it('returns the successful RAG upload when the optional queue is unavailable', async () => {
    documentQueue.enqueueObsidianNote.mockResolvedValue({
      status: 'skipped',
      reason: 'Redis/BullMQ is unavailable',
    });

    const result = await service.ingestText({
      title: 'Guide',
      content: 'Original content',
      userId: 'user-1',
      filename: 'guide.md',
      sourceType: 'document',
    });

    expect(result.rag).toBe(rag);
    expect(result.obsidian).toMatchObject({
      status: 'skipped',
      error: 'Redis/BullMQ is unavailable',
      ragDocId: 'doc-1',
    });
  });

  it('continues RAG upload if the optional Obsidian duplicate lookup fails', async () => {
    obsidianKnowledge.findSourceByContentHash.mockRejectedValue(
      new Error('vault unavailable'),
    );

    await expect(
      service.ingestText({
        title: 'Guide',
        content: 'Original content',
        userId: 'user-1',
        filename: 'guide.md',
        sourceType: 'document',
      }),
    ).resolves.toMatchObject({ rag, obsidian: { status: 'queued' } });
    expect(documentService.upload).toHaveBeenCalled();
  });

  it('reads the PostgreSQL chunks in the worker and writes the reconstructed source note', async () => {
    documentChunkRepo.find.mockResolvedValue([
      {
        content: '章节路径：开始\n第一段。第二段。',
        chunkIndex: 0,
        sectionId: 'section-1',
        sourceStart: 0,
        sourceEnd: 100,
      },
      {
        content: '第二段。第三段。',
        chunkIndex: 1,
        sectionId: 'section-1',
        sourceStart: 0,
        sourceEnd: 100,
      },
      {
        content: '章节路径：结束\n结尾。',
        chunkIndex: 2,
        sectionId: 'section-2',
        sourceStart: 100,
        sourceEnd: 140,
      },
    ]);

    await processor?.({
      taskId: 'obsidian-doc-1',
      docId: 'doc-1',
      userId: 'user-1',
      title: 'Guide',
      contentHash: 'a'.repeat(64),
      sourceType: 'document',
      filename: 'guide.md',
    });

    expect(documentChunkRepo.find).toHaveBeenCalledWith({
      where: { docId: 'doc-1', userId: 'user-1' },
      order: { chunkIndex: 'ASC' },
    });
    expect(obsidianKnowledge.writeSource).toHaveBeenCalledWith(
      expect.objectContaining({
        ragDocId: 'doc-1',
        content:
          '章节路径：开始\n第一段。第二段。第三段。\n\n章节路径：结束\n结尾。',
      }),
    );
  });

  it('does not fail the optional worker task when the source chunks were deleted', async () => {
    await expect(
      processor?.({
        taskId: 'obsidian-doc-1',
        docId: 'deleted-doc',
        userId: 'user-1',
        title: 'Guide',
        contentHash: 'a'.repeat(64),
        sourceType: 'document',
      }),
    ).resolves.toBeUndefined();
    expect(obsidianKnowledge.writeSource).not.toHaveBeenCalled();
  });
});
