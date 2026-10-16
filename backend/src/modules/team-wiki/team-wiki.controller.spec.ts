import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { TeamWikiController } from './team-wiki.controller';
import { TeamWikiService } from './team-wiki.service';
import type { TeamWikiPageInput } from './team-wiki.service';

describe('TeamWikiController tenant scope', () => {
  it('derives tenant and actor from the authenticated user, ignoring tenantId in the request body', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'page-1' });
    const service = { create } as unknown as TeamWikiService;
    const controller = new TeamWikiController(service);
    const user = Object.assign(new JwtPayload(), {
      userId: 'user-1',
      tenantId: 'tenant-a',
      username: 'admin',
      role: 'admin' as const,
    });
    const body: TeamWikiPageInput & { tenantId: string } = {
      title: 'Wiki',
      content: 'Content',
      tenantId: 'tenant-b',
    };

    await controller.create(user, body);

    expect(create).toHaveBeenCalledWith('tenant-a', 'user-1', {
      title: 'Wiki',
      content: 'Content',
      references: undefined,
      changeSummary: undefined,
      expectedRevisionNumber: undefined,
    });
  });
});
