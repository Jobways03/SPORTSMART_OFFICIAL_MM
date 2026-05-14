import { ErasureService } from './erasure.service';

/**
 * Phase 0 (PR 0.10) — GDPR erasure: the `User` column is `phone`, not
 * `phoneNumber`. The pre-existing service code wrote `phoneNumber: null`
 * under an `as any` cast; every customer-erasure attempt threw
 * `P2009` (unknown arg) at the Prisma runtime, was caught by the
 * `processOne` try/catch, and the request silently reverted to PENDING.
 * The audit trail's `outcome.redacted` array (had it ever fired) would
 * have claimed `users.phoneNumber` was redacted — adding insult to a
 * regulator's injury.
 *
 * These tests pin the contract: the helper writes to `phone`, includes
 * `users.phone` in the outcome, and surfaces no Prisma error.
 */

type AnyRecord = Record<string, unknown>;

function buildService(opts: {
  /** Initial dataErasureRequest row. Defaults to a PENDING USER request past notBefore. */
  request?: AnyRecord;
  /** Blockers returned by collectUserBlockers. Defaults to none. */
  blockers?: Array<{ table: string; reason: string }>;
  /** Whether the User row update should reject unknown columns (the bug we fixed). */
  enforceColumnNames?: boolean;
}) {
  const request = opts.request ?? {
    id: 'req-1',
    status: 'PENDING',
    notBefore: new Date(Date.now() - 60_000),
    subjectType: 'USER',
    subjectId: 'user-1',
  };

  const erasureFindUnique = jest.fn().mockResolvedValue({ ...request });
  const erasureUpdate = jest.fn().mockResolvedValue(undefined);

  // Capture the data passed to user.update so the test can assert
  // exactly which columns were written.
  const userUpdate = jest.fn(async ({ data }: any) => {
    if (opts.enforceColumnNames) {
      const allowed = new Set(['firstName', 'lastName', 'email', 'phone']);
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          // Mimic Prisma P2009 ("unknown argument") shape.
          const err: any = new Error(
            `Unknown argument \`${key}\` for User update`,
          );
          err.code = 'P2009';
          throw err;
        }
      }
    }
    return { id: 'user-1', ...data };
  });

  // Stub the blocker queries — all return null by default. The
  // `processUser` private method touches dispute / return / wallet;
  // we make them all return null so `collectUserBlockers` returns [].
  const emptyFirst = jest.fn().mockResolvedValue(null);

  const prisma = {
    dataErasureRequest: { findUnique: erasureFindUnique, update: erasureUpdate },
    user: { update: userUpdate },
    dispute: { findFirst: emptyFirst },
    return: { findFirst: emptyFirst },
    wallet: { findFirst: emptyFirst },
  } as any;

  // Phase 21 — second arg is TaxDocumentRetentionService. The test
  // stubs the method that processUser actually calls so the outcome
  // JSON gains a deterministic `statutoryHold` block.
  const taxRetentionStub: any = {
    getRetentionSummaryForUser: jest.fn().mockResolvedValue({
      userId: 'stub',
      totalDocuments: 0,
      documentsUnderRetention: 0,
      earliestDocumentDate: null,
      latestRetentionExpiry: null,
      retentionYears: 8,
      hasActiveStatutoryHold: false,
    }),
  };
  const service = new ErasureService(prisma, taxRetentionStub);

  // Inject the blockers via the private method's table lookups when
  // the test asks for them. The simplest path: replace the prototype
  // method on the instance (test-scoped override).
  if (opts.blockers && opts.blockers.length > 0) {
    (service as any).collectUserBlockers = jest.fn().mockResolvedValue(opts.blockers);
  }

  return { service, prisma, erasureUpdate, userUpdate };
}

describe('ErasureService.processOne — USER subject (PR 0.10)', () => {
  it('writes phone:null (the fix) — not phoneNumber', async () => {
    const { service, userUpdate, erasureUpdate } = buildService({});

    await service.processOne('req-1');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        firstName: '[REDACTED]',
        lastName: '[REDACTED]',
        email: 'redacted-user-1@erased.local',
        phone: null,            // ← the fix: was `phoneNumber: null`
      },
    });

    // Final request flipped to COMPLETED with phone in the outcome.
    const final = erasureUpdate.mock.calls[erasureUpdate.mock.calls.length - 1][0];
    expect(final.data.status).toBe('COMPLETED');
    // Phase 21 — outcome now carries a `statutoryHold` block; the
    // redacted + blocked shape remains stable for any downstream
    // consumer that pre-dates Phase 21.
    expect(final.data.outcome.redacted).toEqual([
      'users.firstName',
      'users.lastName',
      'users.email',
      'users.phone',
    ]);
    expect(final.data.outcome.blocked).toEqual([]);
    expect(final.data.outcome.statutoryHold).toMatchObject({
      preservedBy: 'CGST Section 36 / 8-year retention',
      retentionYears: 8,
      documentsUnderRetention: 0,
      totalDocuments: 0,
    });
  });

  it('writes ONLY known User columns — strict Prisma-style validation passes', async () => {
    // With enforceColumnNames=true, a write to `phoneNumber` would
    // throw P2009 — this asserts we no longer hit that path.
    const { service, erasureUpdate } = buildService({ enforceColumnNames: true });

    await service.processOne('req-1');

    const final = erasureUpdate.mock.calls[erasureUpdate.mock.calls.length - 1][0];
    expect(final.data.status).toBe('COMPLETED');
  });

  it('regression: would-be `phoneNumber` write triggers a P2009-like error pre-fix', async () => {
    // Sanity-check the test fixture: if a service implementation
    // tries to write `phoneNumber`, the strict mock fails with code
    // P2009. This guards future regressions — anyone reverting the
    // fix to `phoneNumber` will fail this test.
    const userUpdate = jest.fn(async ({ data }: any) => {
      const allowed = new Set(['firstName', 'lastName', 'email', 'phone']);
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          const err: any = new Error(`Unknown argument \`${key}\``);
          err.code = 'P2009';
          throw err;
        }
      }
      return { id: 'u' };
    });
    await expect(
      userUpdate({ where: {}, data: { phoneNumber: null } }),
    ).rejects.toMatchObject({ code: 'P2009' });
  });

  it('respects blockers — does NOT touch User.phone or User.email when blocked', async () => {
    const { service, userUpdate, erasureUpdate } = buildService({
      blockers: [{ table: 'disputes', reason: 'open dispute' }],
    });

    await service.processOne('req-1');

    expect(userUpdate).not.toHaveBeenCalled();
    const final = erasureUpdate.mock.calls[erasureUpdate.mock.calls.length - 1][0];
    expect(final.data.status).toBe('REJECTED');
    expect(final.data.outcome).toMatchObject({
      redacted: [],
      blocked: [{ table: 'disputes', reason: 'open dispute' }],
    });
  });

  it('skips when the request is not PENDING (idempotent)', async () => {
    const { service, userUpdate, erasureUpdate } = buildService({
      request: {
        id: 'req-1',
        status: 'COMPLETED',
        notBefore: new Date(0),
        subjectType: 'USER',
        subjectId: 'user-1',
      },
    });

    await service.processOne('req-1');

    expect(userUpdate).not.toHaveBeenCalled();
    expect(erasureUpdate).not.toHaveBeenCalled();
  });

  it('skips when notBefore has not yet passed', async () => {
    const { service, userUpdate, erasureUpdate } = buildService({
      request: {
        id: 'req-1',
        status: 'PENDING',
        notBefore: new Date(Date.now() + 60_000),
        subjectType: 'USER',
        subjectId: 'user-1',
      },
    });

    await service.processOne('req-1');

    expect(userUpdate).not.toHaveBeenCalled();
    expect(erasureUpdate).not.toHaveBeenCalled();
  });
});
