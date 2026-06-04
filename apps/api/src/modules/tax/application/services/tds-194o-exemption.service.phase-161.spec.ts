// Phase 161 — TDS §194-O exempt seller flow audit remediation coverage.
// Behavioural proof of each finding:
//   B3  grant requires a reason
//   B4  revoke does NOT clear attestation; stamps revoke trail + closes window
//   B1  grant sets effective window; revoke closes it; period-window check
//   #5  audit row on grant + revoke
//   #6  history row (EXEMPT / REVOKE)
//   #11 lifecycle events published
//   #16 bulk grant/revoke
//   B1/#10 isExemptForFilingPeriod is period-keyed (deterministic)

import {
  Tds194OExemptionService,
  TDS194O_EXEMPTION_EVENTS,
} from './tds-194o-exemption.service';
import { isExemptForFilingPeriod } from './tds-194o.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

function buildHarness(opts: any = {}) {
  let seller: any = opts.notFound
    ? null
    : {
        id: 's1',
        is194OExempt: false,
        exempt194OReason: null,
        exempt194OAttestedBy: null,
        exempt194OAttestedAt: null,
        exempt194OEffectiveFrom: null,
        exempt194OEffectiveTo: null,
        exempt194ORevokedBy: null,
        exempt194ORevokedAt: null,
        exempt194ORevokeReason: null,
        ...opts.seller,
      };
  const sellerModel = {
    findUnique: jest.fn(async () => (seller ? { ...seller } : null)),
    update: jest.fn(async ({ data }: any) => {
      seller = { ...seller, ...data };
      return { ...seller };
    }),
  };
  const sellerTdsExemptionHistory = { create: jest.fn(async (_a: any) => ({})) };
  const txClient = { seller: sellerModel, sellerTdsExemptionHistory };
  const prisma: any = {
    seller: sellerModel,
    sellerTdsExemptionHistory,
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(txClient) : Promise.all(arg),
    ),
  };
  const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
  const eventBus: any = { publish: jest.fn(async (_e: any) => undefined) };
  const svc = new Tds194OExemptionService(prisma, audit, eventBus);
  return { svc, sellerModel, sellerTdsExemptionHistory, audit, eventBus };
}

const GOOD_REASON = 'Projected FY gross under ₹5L; PAN verified (CA attested).';

describe('Tds194OExemptionService.grant (Phase 161)', () => {
  it('B1/B3/#5/#6/#11: sets exemption + window, history(EXEMPT), audit, event', async () => {
    const { svc, sellerModel, sellerTdsExemptionHistory, audit, eventBus } = buildHarness();
    await svc.grant({ sellerId: 's1', reason: GOOD_REASON, actorId: 'admin-1' });
    const data = sellerModel.update.mock.calls[0]![0].data;
    expect(data.is194OExempt).toBe(true);
    expect(data.exempt194OReason).toBe(GOOD_REASON);
    expect(data.exempt194OAttestedBy).toBe('admin-1');
    expect(data.exempt194OEffectiveFrom).toBeInstanceOf(Date);
    expect(data.exempt194ORevokedBy).toBeNull(); // clears any prior revoke trail
    expect(sellerTdsExemptionHistory.create.mock.calls[0]![0].data.action).toBe('EXEMPT');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: TDS194O_EXEMPTION_EVENTS.GRANTED, actorId: 'admin-1' }),
    );
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(TDS194O_EXEMPTION_EVENTS.GRANTED);
  });

  it('B3: rejects a missing / short reason', async () => {
    const { svc } = buildHarness();
    await expect(svc.grant({ sellerId: 's1', reason: 'short', actorId: 'a' })).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('B1: rejects effectiveTo <= effectiveFrom', async () => {
    const { svc } = buildHarness();
    await expect(
      svc.grant({
        sellerId: 's1',
        reason: GOOD_REASON,
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        effectiveTo: '2026-03-01T00:00:00.000Z',
        actorId: 'a',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('throws NotFound for a missing seller', async () => {
    const { svc } = buildHarness({ notFound: true });
    await expect(svc.grant({ sellerId: 'x', reason: GOOD_REASON, actorId: 'a' })).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});

describe('Tds194OExemptionService.revoke (Phase 161 B4)', () => {
  it('keeps attestation (no history loss), stamps revoke trail + closes window', async () => {
    const { svc, sellerModel, sellerTdsExemptionHistory, audit } = buildHarness({
      seller: {
        is194OExempt: true,
        exempt194OReason: 'original attestation',
        exempt194OAttestedBy: 'admin-0',
        exempt194OAttestedAt: new Date('2024-04-01T00:00:00.000Z'),
        exempt194OEffectiveFrom: new Date('2024-04-01T00:00:00.000Z'),
      },
    });
    await svc.revoke({ sellerId: 's1', reason: 'Gross crossed the ₹5L threshold', actorId: 'admin-2' });
    const data = sellerModel.update.mock.calls[0]![0].data;
    expect(data.is194OExempt).toBe(false);
    expect(data.exempt194ORevokedBy).toBe('admin-2');
    expect(data.exempt194ORevokeReason).toBe('Gross crossed the ₹5L threshold');
    expect(data.exempt194OEffectiveTo).toBeInstanceOf(Date);
    // B4 — attestation fields are NOT touched (preserved as last-known-good).
    expect(data).not.toHaveProperty('exempt194OReason');
    expect(data).not.toHaveProperty('exempt194OAttestedBy');
    expect(data).not.toHaveProperty('exempt194OAttestedAt');
    expect(sellerTdsExemptionHistory.create.mock.calls[0]![0].data.action).toBe('REVOKE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: TDS194O_EXEMPTION_EVENTS.REVOKED }),
    );
  });

  it('rejects a short revoke reason', async () => {
    const { svc } = buildHarness({ seller: { is194OExempt: true } });
    await expect(svc.revoke({ sellerId: 's1', reason: 'no', actorId: 'a' })).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });
});

describe('Tds194OExemptionService.bulk (Phase 161 #16)', () => {
  it('applies grant + revoke per item and reports counts', async () => {
    const { svc } = buildHarness({ seller: { is194OExempt: true } });
    const res = await svc.bulk({
      actorId: 'admin-1',
      items: [
        { sellerId: 's1', exempt: true, reason: GOOD_REASON },
        { sellerId: 's2', exempt: false, reason: 'Revalidation: no longer eligible' },
      ],
    });
    expect(res.ok).toBe(2);
    expect(res.failed).toHaveLength(0);
  });

  it('captures a per-item failure without aborting the batch', async () => {
    const { svc } = buildHarness();
    const res = await svc.bulk({
      actorId: 'admin-1',
      items: [
        { sellerId: 's1', exempt: true, reason: GOOD_REASON },
        { sellerId: 's2', exempt: true, reason: 'bad' }, // too short → fails
      ],
    });
    expect(res.ok).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.sellerId).toBe('s2');
  });
});

describe('isExemptForFilingPeriod (Phase 161 B1/#10)', () => {
  const P = '2026-Q1';
  it('exempt when the window covers the period start', () => {
    expect(
      isExemptForFilingPeriod(
        { exempt194OEffectiveFrom: new Date('2020-01-01T00:00:00.000Z'), exempt194OEffectiveTo: null },
        P,
      ),
    ).toBe(true);
  });
  it('NOT exempt when effectiveFrom is after the period start (mid-cycle grant)', () => {
    expect(
      isExemptForFilingPeriod(
        { exempt194OEffectiveFrom: new Date('2099-01-01T00:00:00.000Z'), exempt194OEffectiveTo: null },
        P,
      ),
    ).toBe(false);
  });
  it('NOT exempt when the window already closed before the period start', () => {
    expect(
      isExemptForFilingPeriod(
        { exempt194OEffectiveFrom: new Date('2019-01-01T00:00:00.000Z'), exempt194OEffectiveTo: new Date('2020-01-01T00:00:00.000Z') },
        P,
      ),
    ).toBe(false);
  });
  it('null window (legacy backfill) stays exempt', () => {
    expect(
      isExemptForFilingPeriod({ exempt194OEffectiveFrom: null, exempt194OEffectiveTo: null }, P),
    ).toBe(true);
  });
});
