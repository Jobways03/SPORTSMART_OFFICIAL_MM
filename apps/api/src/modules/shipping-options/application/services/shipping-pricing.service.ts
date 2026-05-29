// Phase 91 (2026-05-23) — Shipping pricing engine.
//
// Wraps ShippingOptionsService.quoteOne with the new zone × rate ×
// surcharge resolver. Designed as a strangler around the legacy flat-
// fee path: when no zones match (or no rates configured), the engine
// degrades gracefully to the original `ShippingOption.priceInPaise`
// — preserving today's behaviour while letting ops introduce zones /
// rates / surcharges incrementally.
//
// Inputs the engine looks at (audit Gaps #1–#6):
//   • destinationPincode (Gap #1, #4)  → zone resolution
//   • originPincode (Gap #6)            → cross-zone pricing for
//                                         multi-warehouse / multi-seller
//   • totalWeightGrams (Gap #5)         → weight slab lookup
//   • netCartValueInPaise               → value slab lookup
//   • paymentMethod (Gap #3 COD)        → COD surcharge applies
//   • buyerStateCode                    → CGST/SGST vs IGST split
//
// Output includes the breakdown so the caller can write a typed
// `ShippingQuoteAudit` row + persist the surcharges JSON on the
// MasterOrder snapshot.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { ShippingOptionsService } from './shipping-options.service';
import { deriveStateCodeFromPincode } from '../../../tax/domain/pincode-state';

export interface PricingInput {
  optionId: string;
  netCartValueInPaise: bigint;
  totalWeightGrams?: number;
  destinationPincode?: string | null;
  originPincode?: string | null;
  buyerStateCode?: string | null;
  paymentMethod?: 'COD' | 'ONLINE' | null;
  sellerStateCode?: string | null;
  // Audit context — written to ShippingQuoteAudit.
  cartId?: string | null;
  masterOrderId?: string | null;
  actorType?: 'CUSTOMER' | 'ADMIN' | 'SELLER' | 'SYSTEM';
  actorId?: string | null;
}

export interface PricingResult {
  optionId: string;
  optionName: string;
  rateType: string;
  matchedZoneId: string | null;
  matchedRateId: string | null;
  baseFeeInPaise: bigint;
  surchargesApplied: Array<{
    id: string;
    name: string;
    kind: string;
    contributionPaise: bigint;
  }>;
  feeInPaise: bigint;
  // Phase 91 — Gap #6 GST breakdown. CGST+SGST for intra-state, IGST
  // for inter-state. taxableInPaise = pre-tax when option is exclusive,
  // or back-derived when inclusive.
  taxableInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  gstRateBps: number;
  isFree: boolean;
  freeShippingMinCartPaise: bigint | null;
  transitMinDays: number | null;
  transitMaxDays: number | null;
  estimatedDeliveryFrom: string | null;
  estimatedDeliveryTo: string | null;
}

const DEFAULT_SHIPPING_GST_BPS = 1800; // 18% — CBIC default for SAC 996819.
const PLATFORM_PRICE_CAP_PAISE = 1_00_000_00; // ₹1,00,000.

@Injectable()
export class ShippingPricingService {
  private readonly logger = new Logger(ShippingPricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly optionsService: ShippingOptionsService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Phase 91 — Gap #19 platform max-price cap. Used by the service
   * + admin controller before persisting a new option. Exposed here
   * so other writers (seed scripts, admin override tools) honour
   * the same limit.
   */
  static readonly MAX_PRICE_PAISE = PLATFORM_PRICE_CAP_PAISE;

  /**
   * Resolve the shipping fee for a single option. Falls back to the
   * legacy flat-fee path when no zone / rate matches; writes a
   * ShippingQuoteAudit row in either case.
   */
  async quote(input: PricingInput): Promise<PricingResult> {
    const opt = await this.prisma.shippingOption.findUnique({
      where: { id: input.optionId },
    });
    if (!opt || !opt.isActive) {
      throw new Error(
        'The selected shipping option is no longer available. Please pick another.',
      );
    }
    // Phase 91 — Gap #18 active-window check.
    const now = new Date();
    if (opt.activeFrom && now < opt.activeFrom) {
      throw new Error(
        `Shipping option ${opt.name} is not yet active (activeFrom=${opt.activeFrom.toISOString()})`,
      );
    }
    if (opt.activeUntil && now > opt.activeUntil) {
      throw new Error(
        `Shipping option ${opt.name} expired on ${opt.activeUntil.toISOString()}`,
      );
    }

    // Step 1 — Zone resolution. Match destinationPincode → exact,
    // buyerStateCode → state, region → macro. Highest priority wins.
    const destState =
      input.buyerStateCode ??
      deriveStateCodeFromPincode(input.destinationPincode)?.stateCode ??
      null;
    const matchedZone = await this.resolveZone({
      destinationPincode: input.destinationPincode ?? null,
      stateCode: destState,
    });

    // Step 2 — Slab lookup (Gap #2). Pick the (option, zone, weight,
    // cart-value) bucket the input lands in. Falls back to the
    // option-level flat price when no slab matches.
    const rate = await this.resolveRate({
      optionId: opt.id,
      zoneId: matchedZone?.id ?? null,
      totalWeightGrams: input.totalWeightGrams ?? 0,
      netCartValueInPaise: input.netCartValueInPaise,
    });

    let baseFee: bigint;
    if (rate) {
      const weightExcess = Math.max(
        0,
        (input.totalWeightGrams ?? 0) - rate.minWeightGrams,
      );
      const steps = rate.perKgStep > 0
        ? Math.ceil(weightExcess / rate.perKgStep)
        : 0;
      baseFee = rate.basePaise + BigInt(steps) * rate.perKgPaise;
    } else {
      baseFee = BigInt(opt.priceInPaise.toString());
    }

    // Step 3 — Free-shipping threshold.
    const threshold = opt.freeShippingMinCartPaise
      ? BigInt(opt.freeShippingMinCartPaise.toString())
      : null;
    const alwaysFree = opt.rateType === 'FREE';
    const thresholdMet =
      threshold !== null && input.netCartValueInPaise >= threshold;
    let isFree = alwaysFree || thresholdMet;
    if (isFree) baseFee = 0n;

    // Step 4 — Surcharges (Gap #3). Filter by zone + option + payment
    // method conditions; order by stackingOrder.
    const surchargesApplied: PricingResult['surchargesApplied'] = [];
    if (!isFree) {
      const surcharges = await this.resolveSurcharges({
        optionId: opt.id,
        zoneId: matchedZone?.id ?? null,
        paymentMethod: input.paymentMethod ?? null,
        netCartValueInPaise: input.netCartValueInPaise,
      });
      let running = baseFee;
      for (const s of surcharges) {
        let contribution: bigint;
        if (s.valueType === 'FLAT_PAISE') {
          contribution = s.value;
        } else {
          contribution = (running * s.value) / 10_000n;
        }
        if (s.maxCapPaise && contribution > s.maxCapPaise) {
          contribution = s.maxCapPaise;
        }
        running += contribution;
        surchargesApplied.push({
          id: s.id,
          name: s.name,
          kind: s.kind,
          contributionPaise: contribution,
        });
      }
      baseFee = running;
    }

    // Step 5 — GST split (Gap #6).
    const gstBps = opt.taxGstRateBps ?? DEFAULT_SHIPPING_GST_BPS;
    const { taxable, cgst, sgst, igst } = this.computeGst({
      feeInPaise: baseFee,
      priceIsTaxInclusive: opt.priceIsTaxInclusive,
      gstBps,
      buyerStateCode: destState,
      sellerStateCode: input.sellerStateCode ?? null,
    });

    // Step 6 — EDD (IST-aware).
    const eddFrom = opt.transitMinDays != null
      ? addDaysIst(opt.transitMinDays)
      : null;
    const eddTo = opt.transitMaxDays != null
      ? addDaysIst(opt.transitMaxDays)
      : null;

    const result: PricingResult = {
      optionId: opt.id,
      optionName: opt.name,
      rateType: opt.rateType,
      matchedZoneId: matchedZone?.id ?? null,
      matchedRateId: rate?.id ?? null,
      baseFeeInPaise: rate ? rate.basePaise : BigInt(opt.priceInPaise.toString()),
      surchargesApplied,
      feeInPaise: baseFee,
      taxableInPaise: taxable,
      cgstInPaise: cgst,
      sgstInPaise: sgst,
      igstInPaise: igst,
      gstRateBps: gstBps,
      isFree,
      freeShippingMinCartPaise: threshold,
      transitMinDays: opt.transitMinDays,
      transitMaxDays: opt.transitMaxDays,
      estimatedDeliveryFrom: eddFrom,
      estimatedDeliveryTo: eddTo,
    };

    // Step 7 — Audit. Best-effort; quote should not fail if the
    // audit write fails.
    await this.writeAudit(input, result).catch((err) => {
      this.logger.warn(
        `Shipping quote audit write failed (option=${opt.id}): ${(err as Error).message}`,
      );
    });

    return result;
  }

  private async resolveZone(args: {
    destinationPincode: string | null;
    stateCode: string | null;
  }): Promise<{ id: string; priority: number } | null> {
    const now = new Date();
    const candidates = await this.prisma.shippingZone.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [{ activeFrom: null }, { activeFrom: { lte: now } }],
          },
          {
            OR: [{ activeUntil: null }, { activeUntil: { gte: now } }],
          },
        ],
      },
      select: {
        id: true,
        priority: true,
        pincodes: true,
        states: true,
        regions: true,
      },
      orderBy: { priority: 'desc' },
    });
    if (candidates.length === 0) return null;
    // Most-specific match wins on priority tie.
    for (const z of candidates) {
      if (
        args.destinationPincode &&
        z.pincodes.includes(args.destinationPincode)
      ) {
        return { id: z.id, priority: z.priority };
      }
      if (args.stateCode && z.states.includes(args.stateCode)) {
        return { id: z.id, priority: z.priority };
      }
      // Fallback: any zone with empty constraints (catch-all default).
      if (
        z.pincodes.length === 0 &&
        z.states.length === 0 &&
        z.regions.length === 0
      ) {
        return { id: z.id, priority: z.priority };
      }
    }
    return null;
  }

  private async resolveRate(args: {
    optionId: string;
    zoneId: string | null;
    totalWeightGrams: number;
    netCartValueInPaise: bigint;
  }): Promise<{
    id: string;
    minWeightGrams: number;
    maxWeightGrams: number | null;
    basePaise: bigint;
    perKgPaise: bigint;
    perKgStep: number;
  } | null> {
    const rates = await this.prisma.shippingRate.findMany({
      where: {
        optionId: args.optionId,
        zoneId: args.zoneId ?? undefined,
        isActive: true,
      },
      orderBy: [{ minCartPaise: 'desc' }, { minWeightGrams: 'desc' }],
    });
    for (const r of rates) {
      const wOk =
        args.totalWeightGrams >= r.minWeightGrams &&
        (r.maxWeightGrams === null || args.totalWeightGrams < r.maxWeightGrams);
      const vOk =
        args.netCartValueInPaise >= r.minCartPaise &&
        (r.maxCartPaise === null || args.netCartValueInPaise < r.maxCartPaise);
      if (wOk && vOk) {
        return {
          id: r.id,
          minWeightGrams: r.minWeightGrams,
          maxWeightGrams: r.maxWeightGrams,
          basePaise: r.basePaise,
          perKgPaise: r.perKgPaise,
          perKgStep: r.perKgStep,
        };
      }
    }
    return null;
  }

  private async resolveSurcharges(args: {
    optionId: string;
    zoneId: string | null;
    paymentMethod: 'COD' | 'ONLINE' | null;
    netCartValueInPaise: bigint;
  }): Promise<
    Array<{
      id: string;
      name: string;
      kind: string;
      valueType: string;
      value: bigint;
      maxCapPaise: bigint | null;
    }>
  > {
    const all = await this.prisma.shippingSurcharge.findMany({
      where: {
        isActive: true,
        OR: [
          { optionId: args.optionId },
          { optionId: null },
        ],
        AND: [
          {
            OR: [
              { zoneId: args.zoneId ?? undefined },
              { zoneId: null },
            ],
          },
          {
            OR: [
              { minCartPaise: null },
              { minCartPaise: { lte: args.netCartValueInPaise } },
            ],
          },
        ],
      },
      orderBy: { stackingOrder: 'asc' },
    });
    return all
      .filter((s) => {
        if (s.kind === 'COD') return args.paymentMethod === 'COD';
        // Other kinds apply unconditionally once they pass the
        // option/zone/min-cart filters.
        return true;
      })
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind as any,
        valueType: s.valueType as any,
        value: s.value,
        maxCapPaise: s.maxCapPaise,
      }));
  }

  private computeGst(args: {
    feeInPaise: bigint;
    priceIsTaxInclusive: boolean;
    gstBps: number;
    buyerStateCode: string | null;
    sellerStateCode: string | null;
  }): {
    taxable: bigint;
    cgst: bigint;
    sgst: bigint;
    igst: bigint;
  } {
    if (args.feeInPaise === 0n) {
      return { taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n };
    }
    const rateBps = BigInt(args.gstBps);
    let taxable: bigint;
    let totalTax: bigint;
    if (args.priceIsTaxInclusive) {
      // fee = taxable * (1 + rate); taxable = fee / (1+rate)
      const denom = 10_000n + rateBps;
      taxable = (args.feeInPaise * 10_000n) / denom;
      totalTax = args.feeInPaise - taxable;
    } else {
      taxable = args.feeInPaise;
      totalTax = (taxable * rateBps) / 10_000n;
    }
    const isIntraState =
      args.buyerStateCode &&
      args.sellerStateCode &&
      args.buyerStateCode === args.sellerStateCode;
    if (isIntraState) {
      const half = totalTax / 2n;
      return { taxable, cgst: half, sgst: totalTax - half, igst: 0n };
    }
    return { taxable, cgst: 0n, sgst: 0n, igst: totalTax };
  }

  private async writeAudit(input: PricingInput, result: PricingResult) {
    await this.prisma.shippingQuoteAudit.create({
      data: {
        cartId: input.cartId ?? null,
        masterOrderId: input.masterOrderId ?? null,
        actorType: input.actorType ?? 'SYSTEM',
        actorId: input.actorId ?? null,
        netCartValueInPaise: input.netCartValueInPaise,
        totalWeightGrams: input.totalWeightGrams ?? null,
        destinationPincode: input.destinationPincode ?? null,
        originPincode: input.originPincode ?? null,
        buyerStateCode: input.buyerStateCode ?? null,
        paymentMethod: input.paymentMethod ?? null,
        matchedZoneId: result.matchedZoneId,
        matchedRateId: result.matchedRateId,
        selectedOptionId: result.optionId,
        baseFeeInPaise: result.baseFeeInPaise,
        surchargesAppliedJson: result.surchargesApplied.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          contributionPaise: s.contributionPaise.toString(),
        })) as any,
        feeInPaise: result.feeInPaise,
        taxableInPaise: result.taxableInPaise,
        cgstInPaise: result.cgstInPaise,
        sgstInPaise: result.sgstInPaise,
        igstInPaise: result.igstInPaise,
      },
    });
  }
}

// Phase 91 — Gap #21 IST-aware EDD computation.
function addDaysIst(daysAhead: number): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  ist.setUTCDate(ist.getUTCDate() + daysAhead);
  return ist.toISOString().slice(0, 10);
}
