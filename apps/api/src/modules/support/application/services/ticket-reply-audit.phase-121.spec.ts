// Phase 121 — support reply: central audit trail for privileged (ADMIN) writes
// + confirmation of the already-correct guards (CLOSED, internal-note clamp).

import { SupportService } from './support.service';

const detail = {
  ticket: { id: 't-1', creatorType: 'CUSTOMER', creatorId: 'c-1' },
  messages: [],
};

function build(ticket: any) {
  const repo: any = {
    findTicketById: jest.fn().mockResolvedValue(ticket),
    appendMessage: jest.fn().mockResolvedValue({ id: 'm-1', createdAt: new Date() }),
    findTicketWithMessages: jest.fn().mockResolvedValue(detail),
    updateTicket: jest.fn().mockResolvedValue({}),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(false),
    getNumber: jest.fn().mockReturnValue(0),
  };
  const svc = new SupportService(
    repo,
    {} as any, // prisma — reply uses repo, not prisma directly
    eventBus,
    {} as any, // caseDuplicates
    {} as any, // disputes (mirror path not hit on a non-promoted ticket)
    env,
    audit,
  );
  return { svc, repo, audit, env };
}

const openTicket = {
  id: 't-1', status: 'OPEN',
  creatorType: 'CUSTOMER', creatorId: 'c-1', promotedToDisputeId: null,
};

describe('SupportService.reply — Phase 121', () => {
  it('audits an admin internal note as support.internal_note.created', async () => {
    const { svc, audit } = build(openTicket);
    await svc.reply({
      ticketId: 't-1',
      sender: { type: 'ADMIN', id: 'a-1', name: 'Admin' },
      body: 'private context',
      isInternalNote: true,
    });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.internal_note.created',
        actorId: 'a-1',
      }),
    );
  });

  it('audits an admin public reply as support.admin_reply.created', async () => {
    const { svc, audit } = build(openTicket);
    await svc.reply({
      ticketId: 't-1',
      sender: { type: 'ADMIN', id: 'a-1', name: 'Admin' },
      body: 'hello',
    });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'support.admin_reply.created' }),
    );
  });

  it('does NOT audit a customer reply (the TicketMessage row is its record)', async () => {
    const { svc, audit } = build(openTicket);
    await svc.reply({
      ticketId: 't-1',
      sender: { type: 'CUSTOMER', id: 'c-1', name: 'Cust' },
      body: 'help me',
    });
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects a reply on a CLOSED ticket', async () => {
    const { svc } = build({ ...openTicket, status: 'CLOSED' });
    await expect(
      svc.reply({
        ticketId: 't-1',
        sender: { type: 'CUSTOMER', id: 'c-1', name: 'Cust' },
        body: 'hi',
      }),
    ).rejects.toThrow(/closed/i);
  });

  it('rejects a non-admin reply on a RESOLVED ticket past the reopen window', async () => {
    const { svc, env } = build({
      ...openTicket,
      status: 'RESOLVED',
      resolvedAt: new Date('2020-01-01'),
      ticketNumber: 'TKT-2026-000009',
    });
    (env.getNumber as jest.Mock).mockReturnValue(30); // 30-day window
    await expect(
      svc.reply({
        ticketId: 't-1',
        sender: { type: 'CUSTOMER', id: 'c-1', name: 'Cust' },
        body: 'still broken',
      }),
    ).rejects.toThrow(/more than 30 days ago/i);
  });

  it('clamps a non-admin isInternalNote=true to a public message', async () => {
    const { svc, repo } = build(openTicket);
    await svc.reply({
      ticketId: 't-1',
      sender: { type: 'CUSTOMER', id: 'c-1', name: 'Cust' },
      body: 'hi',
      isInternalNote: true,
    });
    expect(repo.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ isInternalNote: false }),
    );
  });
});
