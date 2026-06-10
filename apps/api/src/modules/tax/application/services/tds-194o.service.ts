// Phase 27 — Section 194-O Income-Tax TDS service.
//
// Manages the lifecycle of `section_194o_tds_ledger` rows. Parallels
// TcsService (GST Section 52) but on GROSS sale value INCLUDING GST
// and on a quarterly cadence (Form 26Q).
//
// Entry points:
//
//   computeForSeller({ sellerId, filingPeriod, computedBy, computedReason })
//     Idempotent. If an active row exists for this (seller, period),
//     returns it. Otherwise aggregates the seller's gross sale for
//     the quarter from the constituent SellerSettlement rows in
//     SettlementCycle.periodEnd inside the quarter, computes the TDS
//     amount via the pure calculator, and persists the new row.
//
//     Rate selection:
//       - 100 bps when seller.panVerified === true
//       - 500 bps when seller.panNumber is missing OR not verified
//                  (Section 206AA penalty rate)
//       - 0 (exempted ledger row not persisted) when seller.is194OExempt
//
//   markWithheld({ ledgerId, settlementId })
//     COMPUTED → WITHHELD. Called from SettlementTdsHookService.
//     markWithheldOnPay when the linked settlement is paid.
//
//   markDeposited({ ledgerIds, depositedBy, challanReference })
//     WITHHELD → DEPOSITED. Bulk admin action after challan submitted.
//
//   markCertificateIssued({ ledgerIds, issuedBy, certificateNumber })
//     DEPOSITED → CERTIFICATE_ISSUED. After Form 16A given to seller.
//
//   reverse({ ledgerId, reversedBy, reason })
//     Any status → REVERSED. Caller then issues a fresh
//     computeForSeller call to produce the corrected row.
//
// See:
//   - docs/tax/TDS_194O_POLICY.md (forthcoming)
//   - apps/api/src/modules/tax/domain/tds-194o-calculator.ts

import { Injectable, Logger } from '@nestjs/common';
import type {
  Section194OTdsLedger,
  Tds194OStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  clampNetSaleWithCarryForward,
  computeTds194O,
  filingPeriodOf,
} from '../../domain/tds-194o-calculator';

export class TdsLedgerNotFoundError extends Error {
  constructor(public readonly ledgerId: string) {
    super(`Section194OTdsLedger ${ledgerId} not found`);
    this.name = 'TdsLedgerNotFoundError';
  }
}

export class TdsInvalidTransitionError extends Error {
  constructor(
    public readonly ledgerId: string,
    public readonly from: Tds194OStatus,
    public readonly to: Tds194OStatus,
  ) {
    super(
      `Section194OTdsLedger ${ledgerId} cannot transition ${from} → ${to}`,
    );
    this.name = 'TdsInvalidTransitionError';
  }
}

export interface ComputeForSellerArgs {
  sellerId: string;
  filingPeriod: string; // "YYYY-Qn"
  computedBy?: string;
  computedReason?: string;
}

// Phase 250 (Franchise tax) — §194-O for a franchise party. Same lifecycle as
// the seller; only the gross-sale base aggregation + party key differ.
export interface ComputeForFranchiseArgs {
  franchiseId: string;
  filingPeriod: string; // "YYYY-Qn"
  computedBy?: string;
  computedReason?: string;
}

export interface ComputeResult {
  ledger: Section194OTdsLedger | null;
  isNew: boolean;
  /** True when no row was created because the seller is exempt OR
   *  the period yielded no gross sale. The hook treats both the
   *  same: the SellerSettlement's tdsLedgerId stays null and
   *  tdsDeductedInPaise stays 0. */
  skipped: boolean;
  skipReason?: string;
}

@Injectable()
export class Tds194OService {
  private readonly logger = new Logger(Tds194OService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Surface the filing-period helper to callers. */
  static filingPeriodOf(date: Date): string {
    return filingPeriodOf(date);
  }

  /**
   * Idempotently compute (or return existing) TDS row for one
   * (seller, quarterly filing-period) pair.
   */
  async computeForSeller(
    args: ComputeForSellerArgs,
  ): Promise<ComputeResult> {
    const existing = await this.prisma.section194OTdsLedger.findFirst({
      where: {
        sellerId: args.sellerId,
        filingPeriod: args.filingPeriod,
        status: { not: 'REVERSED' },
      },
    });
    if (existing) {
      return { ledger: existing, isNew: false, skipped: false };
    }

    // Load the seller's PAN + exemption status. Frozen onto the row.
    const seller = await this.prisma.seller.findUnique({
      where: { id: args.sellerId },
      select: {
        legalBusinessName: true,
        sellerName: true,
        sellerShopName: true,
        panNumber: true,
        panLast4: true,
        panVerified: true,
        is194OExempt: true,
        // Phase 161 (audit B1) — effective-dating for the period-window check.
        exempt194OEffectiveFrom: true,
        exempt194OEffectiveTo: true,
      },
    });
    if (!seller) {
      throw new Error(
        `Tds194OService.computeForSeller: seller ${args.sellerId} not found`,
      );
    }

    // Phase 161 (audit B1/#10) — exempt for THIS filing period only when the
    // exemption window is active at the period start. Period-keyed (not the
    // live flag at compute moment), so a mid-cycle admin toggle can't change
    // an already-started period's treatment — the iteration-order race is gone.
    if (seller.is194OExempt && isExemptForFilingPeriod(seller, args.filingPeriod)) {
      this.logger.log(
        `Section 194-O exemption active for seller ${args.sellerId} for period ` +
          `${args.filingPeriod} — no TDS ledger row written.`,
      );
      return {
        ledger: null,
        isNew: false,
        skipped: true,
        skipReason: 'EXEMPT',
      };
    }

    // Aggregate gross sale from SellerSettlement.totalPlatformAmountInPaise
    // for cycles whose periodEnd falls inside the quarter. Using the
    // settlement is correct because Section 194-O TDS is on the gross
    // amount facilitated by the platform — which is exactly what the
    // platform's settlement run consolidated.
    //
    // For refund reversals, we sum the negative SettlementAdjustment
    // rows on those settlements (returns / chargebacks within the
    // period). Anything older than the period reduces via the carry-
    // forward consumed below.
    const { startUtc, endUtc } = quarterRangeUtc(args.filingPeriod);

    const settlements = await this.prisma.sellerSettlement.findMany({
      where: {
        sellerId: args.sellerId,
        cycle: {
          periodEnd: { gte: startUtc, lt: endUtc },
        },
      },
      select: {
        id: true,
        totalPlatformAmountInPaise: true,
        adjustments: {
          select: {
            amountInPaise: true,
          },
        },
      },
    });

    let grossSaleInPaise = 0n;
    let refundReversalInPaise = 0n;
    for (const s of settlements) {
      grossSaleInPaise += s.totalPlatformAmountInPaise;
      // Negative adjustments = refunds / clawbacks; sum the magnitudes
      // as refund reversal. Positive adjustments don't reduce gross
      // — they're already inside `totalPlatformAmountInPaise` via the
      // settlement aggregation.
      for (const adj of s.adjustments) {
        if (adj.amountInPaise < 0n) {
          refundReversalInPaise += -adj.amountInPaise;
        }
      }
    }

    // Pull prior-period carry-forward — if Q[n-1] had refunds exceeding
    // gross, that residual reduces this quarter's net.
    const priorCarryForward = await this.priorCarryForward(
      args.sellerId,
      args.filingPeriod,
    );

    const { netSaleInPaise, carryForwardInPaise } =
      clampNetSaleWithCarryForward({
        grossSaleInPaise,
        refundReversalInPaise,
        priorCarryForwardInPaise: priorCarryForward,
      });

    const breakdown = computeTds194O({
      grossSaleInPaise: netSaleInPaise,
      hasVerifiedPan:
        !!seller.panNumber && seller.panVerified === true,
    });

    // Zero gross + zero carry-forward = nothing to record. Skip.
    if (
      grossSaleInPaise === 0n &&
      refundReversalInPaise === 0n &&
      priorCarryForward === 0n
    ) {
      return {
        ledger: null,
        isNew: false,
        skipped: true,
        skipReason: 'NO_ACTIVITY',
      };
    }

    const legalName =
      seller.legalBusinessName ??
      seller.sellerShopName ??
      seller.sellerName ??
      null;

    const created = await this.prisma.section194OTdsLedger.create({
      data: {
        sellerId: args.sellerId,
        filingPeriod: args.filingPeriod,
        sellerPanNumber: seller.panNumber,
        sellerPanLast4: seller.panLast4,
        sellerLegalName: legalName,
        hadVerifiedPan: seller.panVerified === true,
        grossSaleInPaise,
        refundReversalInPaise,
        netSaleInPaise,
        adjustmentCarriedForwardInPaise: carryForwardInPaise,
        tdsRateBps: breakdown.rateBps,
        tdsInPaise: breakdown.tdsInPaise,
        status: 'COMPUTED',
        computedBy: args.computedBy ?? null,
        computedReason: args.computedReason ?? null,
      },
    });

    this.logger.log(
      `TDS194O computed for seller ${args.sellerId} period ${args.filingPeriod}: ` +
        `gross=${grossSaleInPaise} refund=${refundReversalInPaise} net=${netSaleInPaise} ` +
        `rate=${breakdown.rateBps}bps tds=${breakdown.tdsInPaise}` +
        (carryForwardInPaise > 0n ? ` carry=${carryForwardInPaise}` : ''),
    );

    return { ledger: created, isNew: true, skipped: false };
  }

  /**
   * Phase 250 (Franchise tax) — §194-O TDS for a franchise, mirroring
   * computeForSeller on the franchise's ONLINE-facilitated gross. Reuses the
   * SAME pure calculator (computeTds194O) + clamp/carry-forward; only the base
   * aggregation and the party key differ. POS / procurement streams are
   * excluded — they are not operator-facilitated e-commerce sales.
   *
   * Base: Σ FranchiseSettlement.totalOnlineAmount (the online sale gross) for
   * cycles whose periodEnd falls in the quarter, less Σ reversalAmount (return
   * clawbacks). Rate: 1% with a verified PAN, 5% (§206AA) otherwise.
   */
  async computeForFranchise(
    args: ComputeForFranchiseArgs,
  ): Promise<ComputeResult> {
    const existing = await this.prisma.section194OTdsLedger.findFirst({
      where: {
        franchiseId: args.franchiseId,
        filingPeriod: args.filingPeriod,
        status: { not: 'REVERSED' },
      },
    });
    if (existing) {
      return { ledger: existing, isNew: false, skipped: false };
    }

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: args.franchiseId },
      select: {
        businessName: true,
        franchiseCode: true,
        ownerName: true,
        panNumber: true,
        panLast4: true,
        verificationStatus: true,
      },
    });
    if (!franchise) {
      throw new Error(
        `Tds194OService.computeForFranchise: franchise ${args.franchiseId} not found`,
      );
    }

    const { startUtc, endUtc } = quarterRangeUtc(args.filingPeriod);
    const settlements = await this.prisma.franchiseSettlement.findMany({
      where: {
        franchiseId: args.franchiseId,
        cycle: { periodEnd: { gte: startUtc, lt: endUtc } },
      },
      select: { totalOnlineAmount: true, reversalAmount: true },
    });

    let grossSaleInPaise = 0n;
    let refundReversalInPaise = 0n;
    for (const s of settlements) {
      // Decimal rupees → paise (BigInt) without IEEE-754 drift.
      grossSaleInPaise += BigInt(s.totalOnlineAmount.mul(100).toFixed(0));
      refundReversalInPaise += BigInt(s.reversalAmount.mul(100).toFixed(0));
    }

    const priorCarryForward = await this.priorCarryForwardForFranchise(
      args.franchiseId,
      args.filingPeriod,
    );

    const { netSaleInPaise, carryForwardInPaise } =
      clampNetSaleWithCarryForward({
        grossSaleInPaise,
        refundReversalInPaise,
        priorCarryForwardInPaise: priorCarryForward,
      });

    // A franchise has a verified PAN when the KYC verification is VERIFIED and
    // a PAN is on file (the §206AA precondition the seller side keys off
    // panVerified for).
    const hasVerifiedPan =
      !!franchise.panNumber && franchise.verificationStatus === 'VERIFIED';
    const breakdown = computeTds194O({
      grossSaleInPaise: netSaleInPaise,
      hasVerifiedPan,
    });

    if (
      grossSaleInPaise === 0n &&
      refundReversalInPaise === 0n &&
      priorCarryForward === 0n
    ) {
      return {
        ledger: null,
        isNew: false,
        skipped: true,
        skipReason: 'NO_ACTIVITY',
      };
    }

    const legalName =
      franchise.businessName ?? franchise.ownerName ?? franchise.franchiseCode ?? null;

    const created = await this.prisma.section194OTdsLedger.create({
      data: {
        partyType: 'FRANCHISE',
        franchiseId: args.franchiseId,
        filingPeriod: args.filingPeriod,
        sellerPanNumber: franchise.panNumber,
        sellerPanLast4: franchise.panLast4,
        sellerLegalName: legalName,
        hadVerifiedPan: hasVerifiedPan,
        grossSaleInPaise,
        refundReversalInPaise,
        netSaleInPaise,
        adjustmentCarriedForwardInPaise: carryForwardInPaise,
        tdsRateBps: breakdown.rateBps,
        tdsInPaise: breakdown.tdsInPaise,
        status: 'COMPUTED',
        computedBy: args.computedBy ?? null,
        computedReason: args.computedReason ?? null,
      },
    });

    this.logger.log(
      `TDS194O computed for FRANCHISE ${args.franchiseId} period ${args.filingPeriod}: ` +
        `gross=${grossSaleInPaise} refund=${refundReversalInPaise} net=${netSaleInPaise} ` +
        `rate=${breakdown.rateBps}bps tds=${breakdown.tdsInPaise}` +
        (carryForwardInPaise > 0n ? ` carry=${carryForwardInPaise}` : ''),
    );

    return { ledger: created, isNew: true, skipped: false };
  }

  /** Franchise variant of priorCarryForward (keyed by franchiseId). */
  private async priorCarryForwardForFranchise(
    franchiseId: string,
    filingPeriod: string,
  ): Promise<bigint> {
    const prior = previousQuarter(filingPeriod);
    if (!prior) return 0n;
    const row = await this.prisma.section194OTdsLedger.findFirst({
      where: {
        franchiseId,
        filingPeriod: prior,
        status: { not: 'REVERSED' },
      },
      select: { adjustmentCarriedForwardInPaise: true },
    });
    return row?.adjustmentCarriedForwardInPaise ?? 0n;
  }

  /** Settlement-paid hook: mark TDS as withheld pending challan deposit. */
  async markWithheld(args: {
    ledgerId: string;
    settlementId: string;
  }): Promise<Section194OTdsLedger> {
    const ledger = await this.prisma.section194OTdsLedger.findUnique({
      where: { id: args.ledgerId },
    });
    if (!ledger) throw new TdsLedgerNotFoundError(args.ledgerId);
    if (ledger.status === 'WITHHELD') return ledger; // idempotent
    if (ledger.status !== 'COMPUTED') {
      throw new TdsInvalidTransitionError(
        args.ledgerId,
        ledger.status,
        'WITHHELD',
      );
    }
    return this.prisma.section194OTdsLedger.update({
      where: { id: args.ledgerId },
      data: {
        status: 'WITHHELD',
        withheldAt: new Date(),
        settlementId: args.settlementId,
      },
    });
  }

  /** Bulk mark DEPOSITED after challan submitted (Form 281/26Q). */
  async markDeposited(args: {
    ledgerIds: string[];
    depositedBy: string;
    challanReference: string;
  }): Promise<number> {
    if (args.ledgerIds.length === 0) return 0;
    const now = new Date();
    const result = await this.prisma.section194OTdsLedger.updateMany({
      where: {
        id: { in: args.ledgerIds },
        status: 'WITHHELD',
      },
      data: {
        status: 'DEPOSITED',
        depositedAt: now,
        depositedBy: args.depositedBy,
        challanReference: args.challanReference,
      },
    });
    this.logger.log(
      `TDS194O mark-deposited: requested=${args.ledgerIds.length} ` +
        `flipped=${result.count} challan=${args.challanReference}`,
    );
    return result.count;
  }

  /** Bulk mark CERTIFICATE_ISSUED after Form 16A issued to seller. */
  async markCertificateIssued(args: {
    ledgerIds: string[];
    issuedBy: string;
    certificateNumber: string;
  }): Promise<number> {
    if (args.ledgerIds.length === 0) return 0;
    const now = new Date();
    const result = await this.prisma.section194OTdsLedger.updateMany({
      where: {
        id: { in: args.ledgerIds },
        status: 'DEPOSITED',
      },
      data: {
        status: 'CERTIFICATE_ISSUED',
        certificateIssuedAt: now,
        certificateIssuedBy: args.issuedBy,
        certificateNumber: args.certificateNumber,
      },
    });
    return result.count;
  }

  /**
   * Reverse a TDS row (correction flow). Caller follows up with a
   * fresh `computeForSeller` to produce the corrected row.
   */
  async reverse(args: {
    ledgerId: string;
    reversedBy: string;
    reason: string;
  }): Promise<Section194OTdsLedger> {
    const ledger = await this.prisma.section194OTdsLedger.findUnique({
      where: { id: args.ledgerId },
    });
    if (!ledger) throw new TdsLedgerNotFoundError(args.ledgerId);
    if (ledger.status === 'REVERSED') return ledger; // idempotent
    return this.prisma.section194OTdsLedger.update({
      where: { id: args.ledgerId },
      data: {
        status: 'REVERSED',
        computedReason:
          `${ledger.computedReason ?? ''} | REVERSED by ${args.reversedBy}: ${args.reason}`.slice(
            0,
            500,
          ),
      },
    });
  }

  /** Per-period rollup of all active (non-REVERSED) rows. Drives the
   *  Form 26Q export. */
  async listForPeriod(
    filingPeriod: string,
  ): Promise<Section194OTdsLedger[]> {
    return this.prisma.section194OTdsLedger.findMany({
      where: {
        filingPeriod,
        status: { not: 'REVERSED' },
      },
      orderBy: [{ sellerId: 'asc' }],
    });
  }

  /**
   * Consume carry-forward from the immediately preceding quarter's
   * row, if any. Returns 0n when no prior row exists.
   */
  private async priorCarryForward(
    sellerId: string,
    filingPeriod: string,
  ): Promise<bigint> {
    const prior = previousQuarter(filingPeriod);
    if (!prior) return 0n;
    const row = await this.prisma.section194OTdsLedger.findFirst({
      where: {
        sellerId,
        filingPeriod: prior,
        status: { not: 'REVERSED' },
      },
      select: { adjustmentCarriedForwardInPaise: true },
    });
    return row?.adjustmentCarriedForwardInPaise ?? 0n;
  }
}

// ───────────────────────────────────────────────────────────────

/**
 * Convert a quarter string "YYYY-Qn" to a UTC start/end Date pair
 * that bounds the quarter's calendar months in IST.
 *
 * Q1 = 1 Apr 00:00 IST → 1 Jul 00:00 IST
 *    = 31 Mar 18:30 UTC of `Y` → 30 Jun 18:30 UTC of `Y`
 */
function quarterRangeUtc(filingPeriod: string): {
  startUtc: Date;
  endUtc: Date;
} {
  const m = /^(\d{4})-Q([1-4])$/.exec(filingPeriod);
  if (!m) {
    throw new Error(`Invalid filing period: "${filingPeriod}"`);
  }
  const y = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10);
  // Q1 starts in Apr (month 3, 0-indexed) of year y; Q2 Jul; Q3 Oct;
  // Q4 Jan of year y+1.
  const startMonthIst: number = [3, 6, 9, 0][q - 1]!;
  const startYearIst = q === 4 ? y + 1 : y;
  // End is start + 3 months, IST.
  const endMonthIst = (startMonthIst + 3) % 12;
  const endYearIst = startMonthIst + 3 >= 12 ? startYearIst + 1 : startYearIst;

  // IST midnight = UTC previous day 18:30.
  const startUtc = new Date(
    Date.UTC(startYearIst, startMonthIst, 1, 0, 0, 0) -
      5.5 * 60 * 60 * 1000,
  );
  const endUtc = new Date(
    Date.UTC(endYearIst, endMonthIst, 1, 0, 0, 0) -
      5.5 * 60 * 60 * 1000,
  );
  return { startUtc, endUtc };
}

/**
 * "2026-Q3" → "2026-Q2"; "2026-Q1" → "2025-Q4"; etc. Used to look
 * up the prior period's carry-forward.
 */
function previousQuarter(filingPeriod: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(filingPeriod);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10);
  if (q === 1) return `${y - 1}-Q4`;
  return `${y}-Q${q - 1}`;
}

/**
 * Phase 161 (audit B1/#10) — is the §194-O exemption active for the given
 * filing period? True when the exemption window covers the period START:
 *   effectiveFrom (null = no lower bound) ≤ periodStart < effectiveTo
 *   (null = open-ended).
 * Period-keyed, so a mid-cycle toggle with effectiveFrom = now does NOT
 * retro-exempt a period that already began (eliminates the iteration race);
 * a deliberate back-dated window applies deterministically to all sellers.
 */
export function isExemptForFilingPeriod(
  eff: { exempt194OEffectiveFrom: Date | null; exempt194OEffectiveTo: Date | null },
  filingPeriod: string,
): boolean {
  const { startUtc } = quarterRangeUtc(filingPeriod);
  const from = eff.exempt194OEffectiveFrom;
  const to = eff.exempt194OEffectiveTo;
  if (from && from.getTime() > startUtc.getTime()) return false;
  if (to && to.getTime() <= startUtc.getTime()) return false;
  return true;
}

