import 'reflect-metadata';
import { FileUrlAuditService } from '../../src/core/file-integrity/file-url-audit.service';
import { TooManyRequestsAppException } from '../../src/core/exceptions';

/**
 * Phase 7 (PR 7.3) — FileUrlAuditService.
 *
 * Exercises the rate-limit ceiling (allow → allow → deny once over
 * the cap) and the per-purpose TTL caps. Both branches are the trust
 * boundary: a bug here either over-blocks legitimate users (false
 * positives) or hands out long-TTL URLs for sensitive docs.
 */
describe('FileUrlAuditService', () => {
  function setup() {
    const created: any[] = [];
    let recentCount = 0;
    const fakePrisma: any = {
      fileUrlAudit: {
        count: jest.fn(async () => recentCount),
        create: jest.fn(async (args: any) => {
          created.push(args.data);
          if (!args.data.denied) recentCount += 1;
          return { ...args.data, id: `audit-${created.length}` };
        }),
      },
    };
    return {
      svc: new FileUrlAuditService(fakePrisma),
      created,
      setRecentCount: (n: number) => {
        recentCount = n;
      },
    };
  }

  it('caps TTL per purpose (KYC=60, INVOICE=120, default=600)', () => {
    const { svc } = setup();
    expect(svc.ttlForPurpose('KYC_DOCUMENT' as any)).toBe(60);
    expect(svc.ttlForPurpose('INVOICE' as any)).toBe(120);
    expect(svc.ttlForPurpose('AVATAR' as any)).toBe(600);
  });

  it('caller hint can lower the TTL but never raise above the cap', () => {
    const { svc } = setup();
    expect(svc.ttlForPurpose('KYC_DOCUMENT' as any, 30)).toBe(30);
    expect(svc.ttlForPurpose('KYC_DOCUMENT' as any, 9999)).toBe(60);
  });

  it('records an allowed issuance', async () => {
    const { svc, created } = setup();
    const result = await svc.recordAttempt({
      fileId: 'f1',
      requesterId: 'u1',
      requesterType: 'USER',
      ttlSeconds: 60,
    });
    expect(result.allowed).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].denied).toBe(false);
    expect(created[0].fileId).toBe('f1');
  });

  it('throws TooManyRequestsAppException when rate-limit exceeded', async () => {
    const { svc, setRecentCount } = setup();
    setRecentCount(30); // at the ceiling
    await expect(
      svc.recordAttempt({
        fileId: 'f1',
        requesterId: 'u1',
        requesterType: 'USER',
        ttlSeconds: 60,
      }),
    ).rejects.toBeInstanceOf(TooManyRequestsAppException);
  });

  it('records the deny when over the rate limit (audit trail of the attempt)', async () => {
    const { svc, created, setRecentCount } = setup();
    setRecentCount(30);
    await svc
      .recordAttempt({
        fileId: 'f1',
        requesterId: 'u1',
        requesterType: 'USER',
        ttlSeconds: 60,
      })
      .catch(() => undefined);
    expect(created).toHaveLength(1);
    expect(created[0].denied).toBe(true);
    expect(created[0].denyReason).toMatch(/rate-limit/);
  });

  it('records expiresAt = now + ttl on allowed issuances', async () => {
    const { svc, created } = setup();
    const before = Date.now();
    await svc.recordAttempt({
      fileId: 'f1',
      requesterId: 'u1',
      requesterType: 'USER',
      ttlSeconds: 300,
    });
    const after = Date.now();
    const exp = (created[0].expiresAt as Date).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 300_000 - 50);
    expect(exp).toBeLessThanOrEqual(after + 300_000 + 50);
  });
});
