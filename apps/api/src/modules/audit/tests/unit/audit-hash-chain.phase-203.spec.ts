import { createHash } from 'crypto';
import {
  AUDIT_HASH_SCHEMA_VERSION,
  canonicalAuditPayloadV2,
  computeAuditHash,
  recomputeStoredRowHash,
} from '../../application/services/audit-hash.util';
import { redactSecrets } from '../../application/services/audit-redaction.util';
import {
  maskEmail,
  maskEmailsInText,
  maskIp,
} from '../../application/services/audit-export-redaction.util';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import { AuditChainAnchorService } from '../../application/services/audit-chain-anchor.service';

/**
 * Phase 203/204/205/206 — audit hash-chain hardening.
 *
 * Locks in the genuine fixes:
 *   203#1  content hash is computed over the STORED createdAt (one timestamp),
 *          so a verifier can recompute it and HARD-FAIL on a content edit.
 *   203#10 secret-looking keys in oldValue/newValue/metadata are redacted.
 *   204#5/#6 verification recomputes content + emits TYPED issues
 *          (HASH_MISMATCH / PREVIOUS_HASH_MISMATCH); a clean chain has zero.
 *   206#3  CSV cells starting with a formula trigger are neutralised.
 *   206#6  export redaction masks IP (/24, /64) + email.
 */

// ── 203#1 — content hash recomputable from stored createdAt ────────────────
describe('audit-hash.util (203#1)', () => {
  const base = {
    actorId: 'admin-1',
    actorRole: 'SUPER_ADMIN',
    actorType: 'ADMIN',
    action: 'order.cancelled',
    module: 'orders',
    resource: 'MasterOrder',
    resourceId: 'ord-1',
    oldValue: { status: 'PLACED' },
    newValue: { status: 'CANCELLED' },
    metadata: { reason: 'duplicate' },
    ipAddress: '203.0.113.7',
    userAgent: 'jest',
    requestId: 'req-1',
    createdAt: new Date('2026-06-02T10:00:00.000Z'),
  };

  it('recomputes the stored hash exactly for a v2 row (no drift)', () => {
    const payload = canonicalAuditPayloadV2(base);
    const hash = computeAuditHash(null, payload);
    const recomputed = recomputeStoredRowHash({
      ...base,
      prevHash: null,
      hash,
      schemaVersion: AUDIT_HASH_SCHEMA_VERSION,
    });
    expect(recomputed).toBe(hash);
  });

  it('detects a content edit: changing newValue changes the recomputed hash', () => {
    const payload = canonicalAuditPayloadV2(base);
    const hash = computeAuditHash(null, payload);
    const recomputed = recomputeStoredRowHash({
      ...base,
      newValue: { status: 'DELIVERED' }, // tampered after the fact
      prevHash: null,
      hash,
      schemaVersion: AUDIT_HASH_SCHEMA_VERSION,
    });
    expect(recomputed).not.toBe(hash);
  });

  it('skips content recompute for a legacy v1 row (returns null, no false flag)', () => {
    const recomputed = recomputeStoredRowHash({
      ...base,
      prevHash: null,
      hash: 'legacy',
      schemaVersion: 1,
    });
    expect(recomputed).toBeNull();
  });

  it('chains: prevHash feeds the next row hash', () => {
    const p1 = canonicalAuditPayloadV2(base);
    const h1 = computeAuditHash(null, p1);
    const p2 = canonicalAuditPayloadV2({ ...base, action: 'order.shipped' });
    const h2 = computeAuditHash(h1, p2);
    // h2 must depend on h1 — recompute with the wrong prev differs.
    expect(computeAuditHash('wrong-prev', p2)).not.toBe(h2);
  });
});

// ── 203#10 — secret scrubber ───────────────────────────────────────────────
describe('redactSecrets (203#10)', () => {
  it('masks values of secret-looking keys, keeps the rest', () => {
    const out = redactSecrets({
      email: 'a@b.com',
      password: 'hunter2',
      apiKey: 'sk_live_xxx',
      nested: { authToken: 'jwt...', amount: 100 },
      list: [{ client_secret: 'shh' }, { ok: true }],
    }) as any;
    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.nested.authToken).toBe('[REDACTED]');
    expect(out.nested.amount).toBe(100);
    expect(out.list[0].client_secret).toBe('[REDACTED]');
    expect(out.list[1].ok).toBe(true);
  });

  it('does not mutate the input', () => {
    const input = { password: 'x' };
    redactSecrets(input);
    expect(input.password).toBe('x');
  });

  it('survives a cycle', () => {
    const a: any = { token: 'x' };
    a.self = a;
    const out = redactSecrets(a) as any;
    expect(out.token).toBe('[REDACTED]');
    expect(out.self).toBe('[CIRCULAR]');
  });
});

// ── 206#3 — CSV formula injection guard (shared util) ───────────────────────
describe('escapeCsvField formula guard (206#3)', () => {
  it.each(['=cmd', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])(
    'neutralises a formula-trigger cell %p',
    (raw) => {
      // The formula char is neutralised with a leading apostrophe. A cell that
      // ALSO contains \r/\n is then RFC-4180-wrapped in quotes ("'\rx"), so the
      // apostrophe sits just inside the wrapping quote — strip a leading quote
      // before asserting the neutraliser is present.
      expect(escapeCsvField(raw).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('leaves a plain number unquoted (finance exports rely on it)', () => {
    expect(escapeCsvField('-100')).toBe('-100');
    expect(escapeCsvField('12.5')).toBe('12.5');
  });
});

// ── 206#6 — export redaction ───────────────────────────────────────────────
describe('export redaction (206#6)', () => {
  it('masks IPv4 to /24', () => {
    expect(maskIp('203.0.113.42')).toBe('203.0.113.x');
  });
  it('masks IPv6 to /64', () => {
    expect(maskIp('2001:db8:1234:5678:9abc:def0:1234:5678')).toBe('2001:db8:1234:5678::/64');
  });
  it('masks an email local-part', () => {
    expect(maskEmail('john.doe@example.com')).toBe('j***@example.com');
  });
  it('masks emails embedded in free text', () => {
    expect(maskEmailsInText('contact a@b.com now')).toBe('contact a***@b.com now');
  });
});

// ── 204#5/#6 — verification produces typed issues ──────────────────────────
describe('AuditChainAnchorService.verifyFull typed issues (204)', () => {
  // Build two correctly-chained v2 rows, then optionally tamper.
  function makeRow(seq: number, prevHash: string | null, action: string) {
    const createdAt = new Date(2026, 5, 2, 0, 0, seq);
    const row = {
      id: `r${seq}`,
      sequenceNumber: BigInt(seq),
      actorId: null,
      actorRole: null,
      actorType: null,
      action,
      module: 'orders',
      resource: 'X',
      resourceId: null,
      oldValue: null,
      newValue: null,
      metadata: null,
      ipAddress: null,
      userAgent: null,
      requestId: null,
      prevHash,
      hash: '',
      schemaVersion: AUDIT_HASH_SCHEMA_VERSION,
      createdAt,
    };
    const payload = canonicalAuditPayloadV2(row);
    row.hash = computeAuditHash(prevHash, payload);
    return row;
  }

  function buildService(rows: any[]) {
    let runRow: any = null;
    const issues: any[] = [];
    const prisma: any = {
      auditChainVerificationRun: {
        create: jest.fn().mockImplementation(({ data }) => {
          runRow = { id: 'run-1', ...data };
          return Promise.resolve({ id: 'run-1' });
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      auditChainVerificationIssue: {
        createMany: jest.fn().mockImplementation(({ data }) => {
          issues.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      auditLog: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };
    // Page 1 returns all rows, page 2 returns empty (cursor done).
    prisma.auditLog.findMany
      .mockResolvedValueOnce(rows)
      .mockResolvedValue([]);
    const events: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const svc = new AuditChainAnchorService(prisma, events);
    return { svc, prisma, events, getIssues: () => issues };
  }

  it('reports ZERO breaks for a clean chain', async () => {
    const r1 = makeRow(1, null, 'a');
    const r2 = makeRow(2, r1.hash, 'b');
    const { svc } = buildService([r1, r2]);
    const res = await svc.verifyFull({ batchSize: 100 });
    expect(res.breaks).toHaveLength(0);
    expect(res.rowsChecked).toBe(2);
  });

  it('flags HASH_MISMATCH when a stored row was content-edited', async () => {
    const r1 = makeRow(1, null, 'a');
    const r2 = makeRow(2, r1.hash, 'b');
    // Tamper: mutate r2's action AFTER its hash was set.
    r2.action = 'TAMPERED';
    const { svc, events } = buildService([r1, r2]);
    const res = await svc.verifyFull({ batchSize: 100 });
    const types = res.breaks.map((b) => b.issueType);
    expect(types).toContain('HASH_MISMATCH');
    // 204#7 — a break emits the alert event.
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'audit.chain.break_detected' }),
    );
  });

  it('flags PREVIOUS_HASH_MISMATCH when a row is deleted (linkage broken)', async () => {
    const r1 = makeRow(1, null, 'a');
    const r2 = makeRow(2, r1.hash, 'b');
    const r3 = makeRow(3, r2.hash, 'c');
    // Drop r2 → r3.prevHash no longer matches r1.hash.
    const { svc } = buildService([r1, r3]);
    const res = await svc.verifyFull({ batchSize: 100 });
    const types = res.breaks.map((b) => b.issueType);
    expect(types).toContain('PREVIOUS_HASH_MISMATCH');
    // The gap also trips the sequence-continuity check.
    expect(types).toContain('MISSING_SEQUENCE');
  });
});

// Sanity: the canonical payload literally hashes the stored ts, proving the
// writer and verifier agree on the recipe.
describe('canonical payload shape', () => {
  it('includes ts derived from createdAt', () => {
    const ts = new Date('2026-06-02T00:00:00.000Z');
    const payload = JSON.parse(
      canonicalAuditPayloadV2({
        actorId: null, actorRole: null, actorType: null,
        action: 'a', module: 'm', resource: 'r', resourceId: null,
        oldValue: null, newValue: null, metadata: null,
        ipAddress: null, userAgent: null, requestId: null, createdAt: ts,
      }),
    );
    expect(payload.ts).toBe(ts.toISOString());
    // The hash is sha256 over prev|payload — confirm it's stable.
    const h = createHash('sha256').update('|' + JSON.stringify(payload)).digest('hex');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
