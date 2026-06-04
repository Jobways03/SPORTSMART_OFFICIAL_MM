import * as crypto from 'crypto';
import { WhatsappWebhookController } from './controllers/whatsapp-webhook.controller';
import { WhatsappInboundTicketHandler } from '../../modules/support/application/event-handlers/whatsapp-inbound-ticket.handler';

// Phase 191 — WhatsApp Webhook flow audit remediation.

const SECRET = 'app-secret-xyz';

function make(over: { user?: any } = {}) {
  const prisma: any = {
    whatsappInbound: { create: jest.fn().mockResolvedValue({}) },
    whatsappStatus: { create: jest.fn().mockResolvedValue({}) },
    whatsappSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    notificationLog: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { findFirst: jest.fn().mockResolvedValue(over.user ?? null) },
  };
  const env: any = {
    getString: (k: string) =>
      k === 'WHATSAPP_APP_SECRET' ? SECRET : k === 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' ? 'verify-tok' : '',
  };
  const session: any = { recordInbound: jest.fn().mockResolvedValue({ optedOut: false, optedIn: false }) };
  const events: any = { emit: jest.fn() };
  const redisClient = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn(), set: jest.fn() };
  const redis: any = { getClient: () => redisClient };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  return { ctrl: new WhatsappWebhookController(env, prisma, session, events, redis, audit), prisma, events, redisClient, audit };
}

function signed(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const req: any = { rawBody: raw, headers: {}, ip: '1.1.1.1' };
  return { req, sig };
}

describe('#17 verification handshake', () => {
  it('requires hub.challenge', () => {
    const { ctrl } = make();
    expect(() => ctrl.verifyWebhook('subscribe', 'verify-tok', undefined)).toThrow(/challenge is required/);
  });
  it('returns the challenge on a valid token', () => {
    const { ctrl } = make();
    expect(ctrl.verifyWebhook('subscribe', 'verify-tok', 'CHAL')).toBe('CHAL');
  });
  it('rejects a wrong token', () => {
    const { ctrl } = make();
    expect(() => ctrl.verifyWebhook('subscribe', 'wrong', 'CHAL')).toThrow();
  });
});

describe('#1/#2/#13 delivery statuses processed', () => {
  it('flips the NotificationLog SENT→DELIVERED + persists the receipt', async () => {
    const { ctrl, prisma } = make();
    const body = {
      entry: [{ id: 'waba1', changes: [{ field: 'messages', value: { statuses: [{ id: 'pm-1', status: 'delivered', recipient_id: '91999', timestamp: '1700000000' }] } }] }],
    };
    const { req, sig } = signed(body);
    const res = await ctrl.handleInbound(req, body as any, sig);
    expect(res.statuses).toBe(1);
    expect(prisma.whatsappStatus.create).toHaveBeenCalled();
    const upd = prisma.notificationLog.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ providerMessageId: 'pm-1', status: 'SENT' });
    expect(upd.data.status).toBe('DELIVERED');
    expect(upd.data.deliveredAt).toBeInstanceOf(Date);
  });

  it('maps a FAILED status to FAILED + a canonical failureCode', async () => {
    const { ctrl, prisma } = make();
    const body = {
      entry: [{ id: 'w', changes: [{ field: 'messages', value: { statuses: [{ id: 'pm-2', status: 'failed', timestamp: '1700000000', errors: [{ code: 131045, title: 'not a wa user' }] }] } }] }],
    };
    const { req, sig } = signed(body);
    await ctrl.handleInbound(req, body as any, sig);
    const upd = prisma.notificationLog.updateMany.mock.calls[0][0];
    expect(upd.data.status).toBe('FAILED');
    expect(upd.data.failureCode).toBe('INVALID_PHONE');
    expect(upd.data.failedAt).toBeInstanceOf(Date);
  });
});

describe('#3/#5 inbound message media + customer match', () => {
  it('extracts media + matches the customer + emits the ticket event', async () => {
    const { ctrl, prisma, events } = make({ user: { id: 'cust-9' } });
    const body = {
      entry: [{ id: 'w', changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: '919876543210', profile: { name: 'Asha' } }],
        messages: [{ id: 'm-1', from: '919876543210', type: 'image', timestamp: '1700000000', image: { id: 'media-7', mime_type: 'image/jpeg' } }],
      } }] }],
    };
    const { req, sig } = signed(body);
    await ctrl.handleInbound(req, body as any, sig);
    const data = prisma.whatsappInbound.create.mock.calls[0][0].data;
    expect(data.mediaId).toBe('media-7');
    expect(data.mediaMimeType).toBe('image/jpeg');
    expect(data.customerId).toBe('cust-9');
    expect(data.contactName).toBe('Asha');
    expect(prisma.whatsappSession.updateMany).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('whatsapp.inbound.received', expect.objectContaining({ customerId: 'cust-9', mediaId: 'media-7' }));
  });

  it('#9 skips an invalid sender phone', async () => {
    const { ctrl, prisma } = make();
    await (ctrl as any).processMessage({ id: 'm', from: 'not-a-phone', type: 'text', text: { body: 'hi' } }, 'w', []);
    expect(prisma.whatsappInbound.create).not.toHaveBeenCalled();
  });
});

describe('#8 signature-failure handling', () => {
  it('rejects an invalid signature + records the failure', async () => {
    const { ctrl, redisClient } = make();
    const body = { entry: [] };
    const raw = Buffer.from(JSON.stringify(body));
    const req: any = { rawBody: raw, headers: {}, ip: '9.9.9.9' };
    await expect(ctrl.handleInbound(req, body as any, 'sha256=deadbeef')).rejects.toThrow(/signature|length/i);
    expect(redisClient.incr).toHaveBeenCalled();
  });

  it('emits an alert + audit when the failure threshold is hit', async () => {
    const { ctrl, redisClient, events, audit } = make();
    redisClient.incr.mockResolvedValue(20); // == SIG_FAIL_THRESHOLD
    await (ctrl as any).recordSignatureFailure({ headers: {}, ip: '9.9.9.9' }, 'bad sig');
    expect(events.emit).toHaveBeenCalledWith('whatsapp.webhook.signature_failing', expect.objectContaining({ count: 20, severity: 90 }));
    expect(audit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'notifications.whatsapp.signature_failed' }));
  });
});

describe('#4 support ticket handler', () => {
  function handler(lock: string | null = 'OK', user: any = { id: 'cust-1', firstName: 'A', lastName: 'B', email: 'a@b.com' }) {
    const support: any = { createSystemTicket: jest.fn().mockResolvedValue({}) };
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const redis: any = { getClient: () => ({ set: jest.fn().mockResolvedValue(lock) }) };
    return { h: new WhatsappInboundTicketHandler(support, prisma, redis), support };
  }

  it('opens a ticket for a matched, non-opt-out message', async () => {
    const { h, support } = handler();
    await h.onInbound({ customerId: 'cust-1', textBody: 'my order is late', messageType: 'text', isOptOut: false });
    expect(support.createSystemTicket).toHaveBeenCalledWith(
      expect.objectContaining({ onBehalfOf: expect.objectContaining({ id: 'cust-1', email: 'a@b.com' }) }),
    );
  });

  it('skips opt-out, anonymous, and dedup-locked messages', async () => {
    const optOut = handler();
    await optOut.h.onInbound({ customerId: 'cust-1', textBody: 'STOP', isOptOut: true });
    expect(optOut.support.createSystemTicket).not.toHaveBeenCalled();

    const anon = handler();
    await anon.h.onInbound({ textBody: 'hi', isOptOut: false });
    expect(anon.support.createSystemTicket).not.toHaveBeenCalled();

    const locked = handler(null); // NX lock not acquired → recent ticket exists
    await locked.h.onInbound({ customerId: 'cust-1', textBody: 'again', isOptOut: false });
    expect(locked.support.createSystemTicket).not.toHaveBeenCalled();
  });
});
