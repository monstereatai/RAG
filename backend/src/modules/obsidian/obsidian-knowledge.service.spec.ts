import { ForbiddenException } from '@nestjs/common';
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
});
