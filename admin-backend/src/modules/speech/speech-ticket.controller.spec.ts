import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SpeechTicketController } from './speech-ticket.controller';

describe('SpeechTicketController', () => {
  it('derives ticket owner from the authenticated request, not request body', async () => {
    const ragClient = {
      issueSpeechTicket: jest.fn().mockResolvedValue({
        available: true,
        data: { data: { ticket: 'speech-one-time', expiresIn: 30 } },
      }),
    };
    const controller = new SpeechTicketController(ragClient as never);
    const request = {
      user: { userId: 42, role: 'admin' },
      body: { ownerUserId: 'attacker', tenantId: 'other-tenant' },
    } as unknown as Request;

    await expect(controller.issueTtsTicket(request)).resolves.toEqual({
      ticket: 'speech-one-time',
      expiresIn: 30,
    });
    expect(ragClient.issueSpeechTicket).toHaveBeenCalledWith('42', 'admin', 'legacy');
  });

  it('rejects a request without a verified user identity', async () => {
    const controller = new SpeechTicketController({
      issueSpeechTicket: jest.fn(),
    } as never);

    await expect(controller.issueTtsTicket({} as Request)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
