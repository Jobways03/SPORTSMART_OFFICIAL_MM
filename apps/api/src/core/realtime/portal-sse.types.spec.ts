import {
  familyOf,
  familyAllowedForScope,
  isInternalOnly,
  normalizeType,
  buildPayloadFor,
  resourceIdOf,
} from './portal-sse.types';

describe('portal-sse.types — family + allowlist', () => {
  it('maps event names to families', () => {
    expect(familyOf('returns.return.qc_completed')).toBe('returns');
    expect(familyOf('disputes.message.added')).toBe('disputes');
    expect(familyOf('tickets.message.added')).toBe('tickets');
    expect(familyOf('sla.breached')).toBe('sla');
    expect(familyOf('orders.created')).toBeNull();
  });

  it('SLA is admin-only — never customer/seller', () => {
    expect(familyAllowedForScope('admin-queue', 'sla')).toBe(true);
    expect(familyAllowedForScope('customer-case', 'sla')).toBe(false);
    expect(familyAllowedForScope('seller-disputes', 'sla')).toBe(false);
  });

  it('customer gets returns/disputes/tickets; seller gets disputes/returns', () => {
    expect(familyAllowedForScope('customer-case', 'tickets')).toBe(true);
    expect(familyAllowedForScope('seller-disputes', 'tickets')).toBe(false);
    expect(familyAllowedForScope('seller-disputes', 'disputes')).toBe(true);
  });

  it('flags admin-internal events', () => {
    expect(isInternalOnly('disputes.refund_rejected')).toBe(true);
    expect(isInternalOnly('tickets.assigned')).toBe(true);
    expect(isInternalOnly('tickets.priority.changed')).toBe(true);
    expect(isInternalOnly('sla.escalated')).toBe(true);
    expect(isInternalOnly('returns.return.approved')).toBe(false);
  });

  it('normalizes domain names to client-stable types', () => {
    expect(normalizeType('disputes.message.added')).toBe('DISPUTE_MESSAGE_CREATED');
    expect(normalizeType('tickets.message.added')).toBe('TICKET_MESSAGE_CREATED');
    expect(normalizeType('returns.return.requested')).toBe('CASE_CREATED');
    expect(normalizeType('disputes.filed')).toBe('CASE_CREATED');
    expect(normalizeType('returns.return.qc_completed')).toBe('CASE_UPDATED');
    expect(normalizeType('sla.breached')).toBe('SLA_BREACH');
  });

  it('resourceIdOf prefers explicit resource id, falls back to aggregate', () => {
    expect(resourceIdOf({ returnId: 'r1' }, 'agg')).toBe('r1');
    expect(resourceIdOf({ disputeId: 'd1' }, 'agg')).toBe('d1');
    expect(resourceIdOf({}, 'agg')).toBe('agg');
  });
});

describe('portal-sse.types — redaction (buildPayloadFor)', () => {
  const disputeMsg = {
    disputeId: 'd1',
    disputeNumber: 'DSP-1',
    body: 'my phone is 99999 and card ends 4242',
    messagePreview: 'my phone is 99999...',
    senderName: 'Priya Sharma',
    amountInPaise: 150000n,
    rationale: 'internal admin reasoning',
    isInternalNote: false,
    eventId: 'evt-1',
  } as Record<string, unknown>;

  it('customer frame: no PII / body / financials / internal notes — only structural fields', () => {
    const out = buildPayloadFor('customer-case', 'disputes.message.added', disputeMsg, 'd1');
    expect(out['body']).toBeUndefined();
    expect(out['messagePreview']).toBeUndefined();
    expect(out['senderName']).toBeUndefined();
    expect(out['amountInPaise']).toBeUndefined();
    expect(out['rationale']).toBeUndefined();
    expect(out['type']).toBe('DISPUTE_MESSAGE_CREATED');
    expect(out['resourceId']).toBe('d1');
    expect(out['number']).toBe('DSP-1');
  });

  it('admin frame: strips raw PII + message body, keeps ids/numbers/amounts for triage', () => {
    const out = buildPayloadFor('admin-queue', 'disputes.message.added', disputeMsg, 'd1');
    expect(out['body']).toBeUndefined();
    expect(out['messagePreview']).toBeUndefined();
    expect(out['senderName']).toBeUndefined(); // name is PII
    expect(out['amountInPaise']).toBe(150000n); // ops needs the figure
    expect(out['disputeNumber']).toBe('DSP-1');
    expect(out['resourceId']).toBe('d1');
  });

  it('ticket frame for a customer never leaks recipient/assignee email or name', () => {
    const ticketEvt = {
      ticketId: 't1',
      ticketNumber: 'TKT-1',
      recipientEmail: 'a@b.com',
      recipientName: 'Bob',
      assigneeEmail: 'admin@x.com',
      assigneeName: 'Admin',
      messagePreview: 'hello',
    } as Record<string, unknown>;
    const out = buildPayloadFor('customer-case', 'tickets.message.added', ticketEvt, 't1');
    for (const k of ['recipientEmail', 'recipientName', 'assigneeEmail', 'assigneeName', 'messagePreview']) {
      expect(out[k]).toBeUndefined();
    }
    expect(out['number']).toBe('TKT-1');
  });
});
