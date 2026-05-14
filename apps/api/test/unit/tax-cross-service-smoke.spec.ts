import 'reflect-metadata';

// Phase 27 GST — Cross-service smoke spec.
//
// Verifies that the pure domain helpers across phases compose
// correctly without re-running the per-service tests. Each test
// exercises a multi-phase invariant that would otherwise need a
// real-DB integration test.

import {
  isWithinSection34Window,
  section34CutoffFor,
} from '../../src/modules/tax/domain/credit-note-time-bar';
import {
  clampNetSupplyWithCarryForward,
  computeTcs,
  filingPeriodOf,
} from '../../src/modules/tax/domain/tcs-calculator';
import {
  decideEInvoiceApplicability,
  DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE,
} from '../../src/modules/tax/domain/einvoice-applicability';
import {
  computeValidUntil,
  computeValidityDays,
} from '../../src/modules/tax/domain/eway-bill-validity';
import {
  computeRetentionExpiry,
  isUnderStatutoryRetention,
  DEFAULT_STATUTORY_RETENTION_YEARS,
} from '../../src/modules/tax/domain/statutory-retention';
import { TaxModeService } from '../../src/modules/tax/application/services/tax-mode.service';
import { TAX_TEMPLATE_KEYS } from '../../src/modules/tax/application/services/tax-notification.service';

describe('Phase 11 ↔ Phase 12 ↔ Phase 13 — Section 34 lifecycle invariant', () => {
  // An invoice issued on 15 Apr 2026 IST (FY 2026-27) has:
  //   - Section 34 cutoff: 30 Sept 2027 23:59:59.999 IST.
  //   - Phase 12 cron classifies as ELIGIBLE up to 7 days before
  //     cutoff (default approachingDays=7).
  //   - Phase 13 wallet-adjustment service routes TIME_BARRED past
  //     the cutoff.
  // This spec asserts those three contracts compose without drift.
  const issuedAt = new Date(Date.UTC(2026, 3, 15, 10, 0, 0));
  const cutoff = section34CutoffFor(issuedAt);

  it('cutoff is end-of-day IST on 30 Sept of FY+1', () => {
    // 30 Sept 2027 23:59:59.999 IST = 30 Sept 2027 18:29:59.999 UTC.
    expect(cutoff.toISOString()).toBe('2027-09-30T18:29:59.999Z');
  });

  it('ELIGIBLE at issuance (Phase 12 path)', () => {
    expect(isWithinSection34Window(issuedAt, issuedAt)).toBe(true);
  });

  it('ELIGIBLE 8 days before cutoff (outside approaching window)', () => {
    const now = new Date('2027-09-22T10:00:00.000Z');
    expect(isWithinSection34Window(issuedAt, now)).toBe(true);
  });

  it('TIME_BARRED 1 second past cutoff (Phase 13 wallet path)', () => {
    const now = new Date(cutoff.getTime() + 1);
    expect(isWithinSection34Window(issuedAt, now)).toBe(false);
  });
});

describe('Phase 16 ↔ Phase 17 — TCS lifecycle invariant', () => {
  // A seller does ₹1L of intra-state sales + ₹50k inter-state in April
  // 2026. Phase 16 computes TCS per leg; Phase 17 deducts it from the
  // settlement payout. The net payout = settlement - total TCS.
  it('intra+inter split → TCS legs sum to 1% of net', () => {
    const tcs = computeTcs({
      intraStateTaxableInPaise: 1_00_000_00n, // ₹1L
      interStateTaxableInPaise: 50_000_00n, // ₹50k
    });
    expect(tcs.cgstTcsInPaise).toBe(50_000n); // 0.5% × ₹1L
    expect(tcs.sgstTcsInPaise).toBe(50_000n);
    expect(tcs.igstTcsInPaise).toBe(50_000n); // 1% × ₹50k
    expect(tcs.totalTcsInPaise).toBe(1_50_000n); // ₹1,500
  });

  it('clamp + carry-forward survives cross-period reversals', () => {
    // April: ₹50k invoiced, ₹100k credit-note → -₹50k net → clamp 0 + carry ₹50k.
    const apr = clampNetSupplyWithCarryForward({
      grossTaxableInPaise: 50_000_00n,
      creditNoteReversalInPaise: 1_00_000_00n,
    });
    expect(apr.netTaxableInPaise).toBe(0n);
    expect(apr.carryForwardInPaise).toBe(50_000_00n);

    // May: ₹1L invoiced, no reversals, but April's ₹50k carry applies.
    const may = clampNetSupplyWithCarryForward({
      grossTaxableInPaise: 1_00_000_00n,
      creditNoteReversalInPaise: 0n,
      priorCarryForwardInPaise: apr.carryForwardInPaise,
    });
    expect(may.netTaxableInPaise).toBe(50_000_00n);
    expect(may.carryForwardInPaise).toBe(0n);
  });

  it('IST-aware filingPeriodOf bucket', () => {
    // 1 May 2026 00:30 IST = 30 Apr 19:00 UTC → "2026-05".
    expect(
      filingPeriodOf(new Date(Date.UTC(2026, 3, 30, 19, 0, 0))),
    ).toBe('2026-05');
  });
});

describe('Phase 15 ↔ Phase 19 — EWB validity meshes with PDF render', () => {
  it('CBIC slab: ≤100km = 1d; 101–300km = 2d; +200km thereafter', () => {
    expect(computeValidityDays(100)).toBe(1);
    expect(computeValidityDays(200)).toBe(2);
    expect(computeValidityDays(300)).toBe(2);
    expect(computeValidityDays(301)).toBe(3);
    const issuedAt = new Date(Date.UTC(2026, 3, 15, 8, 30, 0));
    // 100km → 1-day validity → end-of-IST-day on issuance day.
    expect(computeValidUntil(issuedAt, 100).toISOString()).toBe(
      '2026-04-15T18:29:59.999Z',
    );
    // 200km → 2-day validity → end-of-IST-day on issuance day + 1.
    expect(computeValidUntil(issuedAt, 200).toISOString()).toBe(
      '2026-04-16T18:29:59.999Z',
    );
  });
});

describe('Phase 21 — Retention window is canonical 8 years', () => {
  it('default is 8 years (CGST Section 36 / Rule 56 floor)', () => {
    expect(DEFAULT_STATUTORY_RETENTION_YEARS).toBe(8);
  });

  it('a 2026 invoice retains until exactly 2034', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    expect(computeRetentionExpiry(issued).toISOString()).toBe(
      '2034-04-15T10:00:00.000Z',
    );
    // At the boundary instant, NOT under retention (strict < check).
    expect(
      isUnderStatutoryRetention(
        issued,
        new Date('2034-04-15T10:00:00.000Z'),
      ),
    ).toBe(false);
    // 1ms before, still under retention.
    expect(
      isUnderStatutoryRetention(
        issued,
        new Date('2034-04-15T09:59:59.999Z'),
      ),
    ).toBe(true);
  });
});

describe('Phase 22 — IRP applicability composes across types + thresholds', () => {
  // CBIC threshold is strict-greater-than; an order from a supplier
  // exactly at ₹5 crore is NOT yet applicable.
  it('exactly at ₹5 crore threshold → not applicable', () => {
    const d = decideEInvoiceApplicability({
      documentType: 'TAX_INVOICE',
      documentStatus: 'GENERATED',
      buyerGstin: '07AAGCB1234C1Z5',
      supplierAggregateTurnoverInPaise: DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE,
      supplierEinvoiceOptedIn: false,
    });
    expect(d.applicable).toBe(false);
    expect(d.reason).toMatch(/below the/);
  });

  it('B2C invoice never applies regardless of turnover', () => {
    const d = decideEInvoiceApplicability({
      documentType: 'TAX_INVOICE',
      documentStatus: 'GENERATED',
      buyerGstin: null,
      supplierAggregateTurnoverInPaise:
        DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE * 100n,
      supplierEinvoiceOptedIn: true,
    });
    expect(d.applicable).toBe(false);
    expect(d.reason).toMatch(/B2C/);
  });
});

describe('Phase 23 — Mode helper drives the template banner', () => {
  it('OFF / AUDIT keep DRAFT banner; STRICT suppresses', () => {
    expect(TaxModeService.shouldShowDraftBanner('OFF')).toBe(true);
    expect(TaxModeService.shouldShowDraftBanner('AUDIT')).toBe(true);
    expect(TaxModeService.shouldShowDraftBanner('STRICT')).toBe(false);
  });
});

describe('Phase 24 — Template key registry is shape-stable', () => {
  it('every actor surface has at least one template key', () => {
    expect(Object.keys(TAX_TEMPLATE_KEYS.customer).length).toBeGreaterThan(0);
    expect(Object.keys(TAX_TEMPLATE_KEYS.seller).length).toBeGreaterThan(0);
    expect(Object.keys(TAX_TEMPLATE_KEYS.admin).length).toBeGreaterThan(0);
  });

  it('every key follows the `tax.{actor}.{event}.{channel}` pattern', () => {
    const allKeys = [
      ...Object.values(TAX_TEMPLATE_KEYS.customer),
      ...Object.values(TAX_TEMPLATE_KEYS.seller),
      ...Object.values(TAX_TEMPLATE_KEYS.admin),
    ];
    for (const key of allKeys) {
      expect(key).toMatch(/^tax\.(customer|seller|admin)\.[a-z0-9_]+\.[a-z]+$/);
    }
  });

  it('keys are globally unique (no accidental duplicates)', () => {
    const allKeys = [
      ...Object.values(TAX_TEMPLATE_KEYS.customer),
      ...Object.values(TAX_TEMPLATE_KEYS.seller),
      ...Object.values(TAX_TEMPLATE_KEYS.admin),
    ];
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
