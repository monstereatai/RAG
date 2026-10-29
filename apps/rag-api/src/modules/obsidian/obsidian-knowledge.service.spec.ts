import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObsidianKnowledgeService } from './obsidian-knowledge.service';

describe('ObsidianKnowledgeService ACL', () => {
  const service = new ObsidianKnowledgeService(
    { get: jest.fn() } as never,
    { invoke: jest.fn() } as never,
  );

  beforeEach(() => jest.restoreAllMocks());

  it('filters graph export by the authenticated user while retaining public notes', async () => {
    jest.spyOn(service as any, 'readAllNotes').mockResolvedValue([
      {
        path: 'notes/owner.md',
        content:
          '---\ntitle: "Owner Note"\nallowed_users: ["owner-1"]\ntopics: ["topic-owner"]\n---\n# Owner Note',
      },
      {
        path: 'notes/other.md',
        content:
          '---\ntitle: "Other Note"\nallowed_users: ["other-user"]\ntopics: ["topic-other"]\n---\n# Other Note',
      },
      {
        path: 'notes/public.md',
        content:
          '---\ntitle: "Public Note"\ntopics: ["topic-public"]\n---\n# Public Note',
      },
    ]);

    const result = await service.exportGraphSeed({ userId: 'owner-1' });
    const nodeIds = result.nodes.map((node) => node.id);

    expect(nodeIds).toContain('Owner Note');
    expect(nodeIds).toContain('Public Note');
    expect(nodeIds).not.toContain('Other Note');
    expect(nodeIds).not.toContain('topic-other');
  });

  it('fails closed when graph export has no authenticated identity', async () => {
    await expect(service.exportGraphSeed({})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('marks source-note search hits from frontmatter while leaving manual notes unmarked', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'obsidian-search-'));
    const sourcePath = join(vaultDir, 'source.md');
    const manualPath = join(vaultDir, 'manual.md');
    try {
      await writeFile(
        sourcePath,
        '---\ntitle: "发布审批来源"\ntype: source_note\n---\n# 发布审批来源',
      );
      await writeFile(
        manualPath,
        '---\ntitle: "发布审批补充"\n---\n# 发布审批补充',
      );
      const searchService = new ObsidianKnowledgeService(
        {
          get: jest.fn((key: string) =>
            key === 'obsidian.vaultDir' ? vaultDir : undefined,
          ),
        } as never,
        { invoke: jest.fn() } as never,
      );
      jest
        .spyOn(searchService as any, 'ensureVault')
        .mockResolvedValue(undefined);
      jest.spyOn(searchService as any, 'listMarkdownFiles').mockResolvedValue([
        { path: sourcePath, type: 'note' },
        { path: manualPath, type: 'note' },
      ]);
      jest
        .spyOn(searchService as any, 'extractTokens')
        .mockReturnValue(new Set(['发布审批']));
      jest.spyOn(searchService as any, 'scoreText').mockReturnValue(1);

      const hits = await searchService.search('发布审批', 5, {
        userId: 'user-1',
      });

      expect(hits.find((hit) => hit.path === sourcePath)?.isSourceNote).toBe(
        true,
      );
      expect(
        hits.find((hit) => hit.path === manualPath)?.isSourceNote,
      ).toBeUndefined();
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });
});

describe('ObsidianKnowledgeService source note hashes', () => {
  const service = new ObsidianKnowledgeService(
    { get: jest.fn() } as never,
    { invoke: jest.fn() } as never,
  );

  beforeEach(() => jest.restoreAllMocks());

  const stubWritePipeline = () => {
    jest.spyOn(service as any, 'ensureVault').mockResolvedValue(undefined);
    const findNoteByHash = jest
      .spyOn(service as any, 'findNoteByHash')
      .mockResolvedValue(null);
    jest.spyOn(service as any, 'buildDraft').mockResolvedValue({ tags: [] });
    jest.spyOn(service as any, 'writeRaw').mockResolvedValue('raw.md');
    const writeNote = jest
      .spyOn(service as any, 'writeNote')
      .mockResolvedValue('note.md');
    jest.spyOn(service as any, 'refreshIndexes').mockResolvedValue(undefined);
    return { findNoteByHash, writeNote };
  };

  it('uses a valid original content hash when the stored note body was reconstructed', async () => {
    const { findNoteByHash, writeNote } = stubWritePipeline();
    const originalHash = 'a'.repeat(64);

    const result = await service.writeSource({
      userId: 'user-1',
      title: 'Guide',
      content: 'Reconstructed chunk text',
      contentHash: originalHash,
      ragDocId: 'doc-1',
      sourceType: 'document',
    });

    expect(findNoteByHash).toHaveBeenCalledWith(originalHash, {
      userId: 'user-1',
    });
    expect(writeNote).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: originalHash }),
    );
    expect(result).toMatchObject({
      status: 'saved',
      contentHash: originalHash,
    });
  });

  it('keeps deriving the hash from content for direct callers', async () => {
    stubWritePipeline();

    const result = await service.writeSource({
      userId: 'user-1',
      title: 'Guide',
      content: '  Original text  ',
      sourceType: 'manual',
    });

    expect(result.contentHash).toBe(
      createHash('sha256').update('Original text').digest('hex'),
    );
  });

  it('rejects malformed supplied hashes', async () => {
    await expect(
      service.writeSource({
        userId: 'user-1',
        title: 'Guide',
        content: 'Original text',
        contentHash: 'not-a-sha256',
        sourceType: 'manual',
      }),
    ).rejects.toThrow('64-character SHA-256');
  });
});
