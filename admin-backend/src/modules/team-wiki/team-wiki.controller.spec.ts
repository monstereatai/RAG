import { TeamWikiController } from './team-wiki.controller';
import { RagClientService } from '../rag-client/rag-client.service';

describe('Admin TeamWikiController', () => {
  it('derives owner identity from the authenticated request when creating a page', async () => {
    const ragClient = {
      createTeamWikiPage: jest.fn().mockResolvedValue({
        available: true,
        status: 201,
        data: { id: 'page-1' },
      }),
    } as unknown as RagClientService;
    const controller = new TeamWikiController(ragClient);

    await expect(controller.create(
      { title: 'Team wiki', tenantId: 'attacker-tenant' },
      { user: { userId: 'admin-user' } } as any,
    )).resolves.toEqual({ id: 'page-1' });

    expect(ragClient.createTeamWikiPage).toHaveBeenCalledWith('admin-user', {
      title: 'Team wiki',
      content: undefined,
      references: undefined,
      changeSummary: undefined,
      expectedRevisionNumber: undefined,
    });
  });

  it('surfaces an unavailable RAG service as a gateway error', async () => {
    const ragClient = {
      listTeamWikiPages: jest.fn().mockResolvedValue({
        available: false,
        status: null,
        data: null,
        error: 'fetch failed',
      }),
    } as unknown as RagClientService;
    const controller = new TeamWikiController(ragClient);

    await expect(controller.list(undefined, undefined, { user: { userId: 'admin-user' } } as any)).rejects.toThrow('fetch failed');
  });
});
