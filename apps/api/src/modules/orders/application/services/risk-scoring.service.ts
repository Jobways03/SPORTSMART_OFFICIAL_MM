import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../core/exceptions';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import {
  RiskRuleConfigService,
  OrderRiskReasonCodeKey,
} from './risk-rule-config.service';

// Phase 174 (audit #224/#227) — CRITICAL is the 4th band above RED so the
// highest-risk cohort can be triaged first and held to the bounded
// enforcement gate (mandatory reason on approve, excluded from bulk-approve).
export type RiskBand = 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL';

/**
 * Phase 69 (2026-05-22) — Phase 68 audit Gap #20. Structured reason
 * shape so each rule contribution can be persisted to OrderRiskReason
 * for queryability. The legacy `reasons: string[]` is still derived
 * (from `text`) on the way out so existing callers / specs continue
 * to work; the new `reasonRows` field is the canonical structured
 * form for the persistence path.
 *
 * Phase 71 (2026-05-22) — Phase 70 risk-scoring audit Gap #11.
 * Added codes for the new rules: PINCODE_RTO, CANCELLATION_HISTORY,
 * SUSPICIOUS_EMAIL, VELOCITY.
 */
export type OrderRiskReasonCode =
  | 'FIRST_TIME_CUSTOMER'
  | 'REPEAT_CUSTOMER'
  | 'COD_PAYMENT'
  | 'ONLINE_CAPTURED'
  | 'ONLINE_NOT_CAPTURED'
  | 'VERY_HIGH_VALUE'
  | 'HIGH_VALUE'
  | 'BULK_ORDER'
  | 'PINCODE_RTO'
  | 'CANCELLATION_HISTORY'
  | 'SUSPICIOUS_EMAIL'
  | 'VELOCITY'
  | 'OTHER';

export interface RiskReasonRow {
  code: OrderRiskReasonCode;
  text: string;
  scoreDelta: number;
}

export interface RiskScore {
  score: number;
  band: RiskBand;
  reasons: string[];
  reasonRows: RiskReasonRow[];
}

/**
 * Pre-screening rules. Each rule contributes to the score and may
 * append a human-readable reason. Negative deltas signal "this is a
 * trustworthy order"; positive deltas signal "verifier should look".
 *
 * The numbers are deliberately blunt — this is a signal, not a verdict.
 * Tune as the team gathers data on which signals correlate with actual
 * fraud / cancellations / chargebacks.
 *
 * If you change the rules, bump SCORER_VERSION + run POST
 * /admin/verification/backfill-scores to re-score all PLACED orders
 * so the queue reflects the new logic.
 *
 * Phase 71 (2026-05-22) — Phase 70 risk-scoring audit Gap #10.
 * SCORER_VERSION is stamped on every OrderRiskScoreHistory row and
 * on MasterOrder.verificationScoreVersion so a future rule change
 * can target only stale rows. Bump it whenever rule weights /
 * thresholds change.
 */
export const SCORER_VERSION = 2;

const HIGH_VALUE_THRESHOLD = 10_000;
const VERY_HIGH_VALUE_THRESHOLD = 25_000;
const BULK_ITEM_THRESHOLD = 10;

// Phase 71 (audit Gap #11) — new rule thresholds.
const CANCELLATION_LOOKBACK_DAYS = 90;
const CANCELLATION_RATE_THRESHOLD = 0.3; // > 30%
const CANCELLATION_MIN_PRIOR = 3; // need at least 3 prior orders to compute meaningful rate
const VELOCITY_LOOKBACK_MINUTES = 60;
const VELOCITY_THRESHOLD = 3; // > 3 orders in last hour
// Conservative disposable-email allowlist. Real fraud-ops sets are
// hundreds of domains; we ship a starter list that covers the most
// common throwaways and let the rule's reason text guide an
// operator to a manual confirm. Update via code change + bump
// SCORER_VERSION.
const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  '10minutemail.com',
  'yopmail.com',
  'throwawaymail.com',
  'getnada.com',
  'sharklasers.com',
  'maildrop.cc',
  'fake-mail.net',
]);
// Indicative high-RTO pincode list. Operationally this should be
// driven by a `PincodeRtoStats` table aggregated from delivery
// outcomes; the static list keeps the rule firing today while that
// table accumulates data. The audit (Gap #11) calls for a real RTO
// history rule, which this approximates.
const HIGH_RTO_PINCODES = new Set<string>([
  // populated empty by default; ops can add via code change. The
  // rule degrades to a no-op when the set is empty so this is safe.
]);

const BAND_THRESHOLDS = {
  GREEN_MAX: 0,
  YELLOW_MAX: 14,
  // Phase 174 — RED spans 15..30; above 30 escalates to CRITICAL.
  RED_MAX: 30,
};

// Phase 174 (audit #224-#13) — risk scoring is only meaningful (and only
// writable) while an order is in a pre-verification state. Re-scoring a
// VERIFIED / ROUTED / CANCELLED / REJECTED order would overwrite a
// finalized band, so scoreOrder refuses + CAS-guards the write.
const SCORABLE_STATUSES = [
  'PENDING_PAYMENT',
  'PLACED',
  'PENDING_VERIFICATION',
] as const;

@Injectable()
export class RiskScoringService {
  private readonly logger = new Logger(RiskScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase 7 (PR 7.7) — masterOrder.update is status-only here (risk
    // score + band + reasons), so the helper no-ops; wired for the
    // coverage-spec invariant and to future-proof against payload
    // changes that might add a money field.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    // Phase 72 (2026-05-22) — Phase 71 audit Gap #12. Per-rule
    // weight + threshold lookup. Falls back to in-code DEFAULTS
    // when DB unreachable so scoring never fails on a config
    // outage. @Optional so legacy specs that construct the service
    // directly (without DI) keep working.
    @Optional()
    private readonly ruleConfig?: RiskRuleConfigService,
  ) {}

  /**
   * Compute and persist the risk score for a single order. Idempotent —
   * called multiple times for the same order will overwrite with the
   * latest computation. Returns the resulting band so callers can act
   * on it (e.g. include in claim-next response).
   *
   * Phase 71 (2026-05-22) — Phase 70 audit Gaps #8 + #9 + #10 + #11 + #13 + #19:
   *   - Writes OrderRiskScoreHistory row in the same tx (#8).
   *   - Stamps verificationScoredBy + verificationScoreSource (#9).
   *   - Stamps verificationScoreVersion = SCORER_VERSION (#10).
   *   - Reads customer email + shipping address + recent cancellations
   *     for the new rules (#11).
   *   - Subtracts shippingFeeInPaise from the value threshold (#13).
   *   - Reads sub-orders/items (light — only count + product ids)
   *     for future per-product rules; currently feeds the BULK_ORDER
   *     check (was using header itemCount; now sums true item rows
   *     when available, #19).
   */
  async scoreOrder(
    orderId: string,
    options: { source?: 'RULES' | 'MANUAL'; scoredBy?: string } = {},
  ): Promise<RiskScore> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderStatus: true,
        customerId: true,
        totalAmount: true,
        itemCount: true,
        paymentMethod: true,
        paymentStatus: true,
        createdAt: true,
        shippingFeeInPaise: true,
        shippingAddressSnapshot: true,
        // Phase 71 (audit Gap #19) — read sub-orders + items so
        // future per-product / per-seller rules have data to work
        // with. Today we only use the count (the header itemCount
        // can drift if an admin edits a sub-order; the joined sum
        // is the source of truth).
        subOrders: {
          select: {
            id: true,
            items: { select: { id: true, productId: true, quantity: true } },
          },
        },
        customer: {
          select: { email: true },
        },
      },
    });
    if (!order) throw new NotFoundAppException('Order not found');

    // Phase 174 (audit #224-#13) — refuse to score an order that has left
    // the pre-verification lifecycle. The placement handler + lazy paths
    // only ever hit PLACED/PENDING_PAYMENT; a manual rescore on a
    // CANCELLED/VERIFIED order would otherwise stomp a finalized score.
    if (!(SCORABLE_STATUSES as readonly string[]).includes(order.orderStatus)) {
      throw new BadRequestAppException(
        `Cannot score order in status ${order.orderStatus} — only pre-verification orders are scorable`,
      );
    }

    // Count prior orders this customer has had, EXCLUDING cancelled /
    // rejected ones (audit #224-#14). Pre-fix a customer with 10 cancelled
    // orders earned the -10 "repeat customer" trust bonus — rewarding
    // exactly the behaviour the verification queue exists to catch. Only
    // orders that actually progressed count toward trust history.
    const priorOrderCount = await this.prisma.masterOrder.count({
      where: {
        customerId: order.customerId,
        id: { not: order.id },
        orderStatus: { notIn: ['CANCELLED', 'REJECTED'] as any },
      },
    });

    // Phase 71 (audit Gap #11) — cancellation rate over the lookback
    // window. Only fires when there's enough history (>= MIN_PRIOR)
    // so a one-off cancellation on a 2-order customer doesn't flag.
    let cancellationRate: number | null = null;
    let cancellationsInWindow = 0;
    let priorInWindow = 0;
    if (priorOrderCount >= CANCELLATION_MIN_PRIOR) {
      const cutoff = new Date(
        Date.now() - CANCELLATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      );
      const [totalInWindow, cancelledInWindow] = await Promise.all([
        this.prisma.masterOrder.count({
          where: {
            customerId: order.customerId,
            id: { not: order.id },
            createdAt: { gte: cutoff },
          },
        }),
        this.prisma.masterOrder.count({
          where: {
            customerId: order.customerId,
            id: { not: order.id },
            createdAt: { gte: cutoff },
            orderStatus: 'CANCELLED',
          },
        }),
      ]);
      priorInWindow = totalInWindow;
      cancellationsInWindow = cancelledInWindow;
      if (totalInWindow >= CANCELLATION_MIN_PRIOR) {
        cancellationRate = cancelledInWindow / totalInWindow;
      }
    }

    // Phase 71 (audit Gap #11) — velocity check: orders placed in
    // the lookback window for this customer (excluding this one).
    const velocityCutoff = new Date(
      Date.now() - VELOCITY_LOOKBACK_MINUTES * 60 * 1000,
    );
    const recentOrderCount = await this.prisma.masterOrder.count({
      where: {
        customerId: order.customerId,
        id: { not: order.id },
        createdAt: { gte: velocityCutoff },
      },
    });

    // Phase 71 (audit Gap #13) — exclude shipping fee from the value
    // threshold. A ₹9,900 order with ₹100 shipping shouldn't trip the
    // ₹10K bucket.
    const shippingPaise = Number(order.shippingFeeInPaise ?? 0n);
    const goodsAmount = Math.max(
      0,
      Number(order.totalAmount) - shippingPaise / 100,
    );

    // Phase 71 (audit Gap #19) — true item count from sub-orders.
    // Defensive: mocks / partial loads may not include the
    // subOrders relation. Falls back to the header itemCount.
    const trueItemCount =
      (order.subOrders ?? []).reduce(
        (sum: number, so) =>
          sum + (so.items ?? []).reduce((s2, it) => s2 + (it.quantity ?? 0), 0),
        0,
      ) || order.itemCount;

    // Phase 71 (audit Gap #11) — shipping pincode extracted from
    // the address snapshot (Json column).
    const addr = (order.shippingAddressSnapshot ?? null) as
      | { postalCode?: string | null }
      | null;
    const shippingPincode = addr?.postalCode ?? null;

    const customerEmail = order.customer?.email ?? null;

    // Phase 72 (audit Gap #12) — pull current rule config from DB
    // (cached). Missing rows fall back to in-code defaults.
    const rules = this.ruleConfig ? await this.ruleConfig.getAll() : null;

    const result = computeScore(
      {
        priorOrderCount,
        goodsAmount,
        itemCount: trueItemCount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        shippingPincode,
        customerEmail,
        cancellationRate,
        cancellationsInWindow,
        priorInWindow,
        recentOrderCount,
      },
      rules,
    );

    const source: 'RULES' | 'MANUAL' = options.source ?? 'RULES';
    const scoredBy = options.scoredBy ?? null;
    const now = new Date();

    // Phase 71 (audit Gap #8) — write history row alongside the
    // current-state update. The OrderRiskReason child table from
    // Phase 69 is replaced on every rescore (current-state denorm);
    // OrderRiskScoreHistory is append-only (temporal record).
    await this.prisma.$transaction(async (tx) => {
      // Phase 174 (audit #224-#13) — CAS the write to the scorable statuses
      // so a verify/cancel that landed between our read above and this write
      // is not clobbered by a now-stale band. count===0 → the order left the
      // lifecycle under us; throw to roll the whole tx back (history +
      // reasons included). Note: applyPaise is the documented money-dual-write
      // coverage invariant (no-op for masterOrder), retained intentionally.
      const written = await tx.masterOrder.updateMany({
        where: {
          id: orderId,
          orderStatus: { in: SCORABLE_STATUSES as any },
        },
        data: this.moneyDualWrite.applyPaise('masterOrder', {
          verificationRiskScore: result.score,
          verificationRiskBand: result.band,
          verificationRiskReasons: result.reasons,
          verificationScoredAt: now,
          verificationScoredBy: scoredBy,
          verificationScoreSource: source,
          verificationScoreVersion: SCORER_VERSION,
        }),
      });
      if (written.count === 0) {
        throw new BadRequestAppException(
          'Order is no longer in a scorable state (changed concurrently)',
        );
      }
      // OrderRiskReason: replace per-rule denormalisation.
      await tx.orderRiskReason.deleteMany({ where: { masterOrderId: orderId } });
      if (result.reasonRows.length > 0) {
        await tx.orderRiskReason.createMany({
          data: result.reasonRows.map((r) => ({
            masterOrderId: orderId,
            reasonCode: r.code,
            reasonText: r.text,
            scoreDelta: r.scoreDelta,
          })),
        });
      }
      // OrderRiskScoreHistory: append-only audit trail.
      await tx.orderRiskScoreHistory.create({
        data: {
          masterOrderId: orderId,
          score: result.score,
          band: result.band,
          reasons: result.reasons,
          source,
          scoredAt: now,
          scoredBy,
          scorerVersion: SCORER_VERSION,
        },
      });
    });

    this.logger.log(
      `Scored order ${orderId}: ${result.band} (${result.score}, v${SCORER_VERSION}, ${source}) — ${result.reasons.join(', ')}`,
    );
    return result;
  }

  /**
   * One-shot backfill of every PLACED order whose risk score has never
   * been computed (or that was created before this feature shipped).
   * Safe to re-run; uses the same scoreOrder path so future-loaded rules
   * apply uniformly. Returns the number scored.
   *
   * Phase 71 (audit Gap #10) — also catches orders whose
   * verificationScoreVersion is below the current SCORER_VERSION
   * (rule-set bump). The endpoint is idempotent on the version check
   * — re-running after a successful pass is a no-op.
   */
  async backfillUnscored(
    opts: { dryRun?: boolean; limit?: number } = {},
  ): Promise<{
    scored: number;
    staleRescored: number;
    failed: number;
    failedIds: string[];
    candidateCount: number;
    dryRun: boolean;
  }> {
    // Phase 174 (audit #225) — bound the scan so a 100k-order backlog can't
    // load every row into memory + block the request for minutes. The work
    // drains across repeated calls (idempotent on the band/version filter).
    const cap = Math.min(Math.max(1, Math.floor(opts.limit ?? 500)), 5000);

    const unscored = await this.prisma.masterOrder.findMany({
      where: { orderStatus: 'PLACED', verificationRiskBand: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: cap,
    });
    const remaining = Math.max(0, cap - unscored.length);
    const stale =
      remaining > 0
        ? await this.prisma.masterOrder.findMany({
            where: {
              orderStatus: 'PLACED',
              verificationRiskBand: { not: null },
              verificationScoreVersion: { lt: SCORER_VERSION },
            },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: remaining,
          })
        : [];

    const candidateCount = unscored.length + stale.length;

    // Phase 174 (audit #225) — dry-run preview: report what WOULD be scored
    // without touching anything, so a SUPER_ADMIN can size the run first.
    if (opts.dryRun) {
      return {
        scored: 0,
        staleRescored: 0,
        failed: 0,
        failedIds: [],
        candidateCount,
        dryRun: true,
      };
    }

    let scored = 0;
    let staleRescored = 0;
    const failedIds: string[] = [];
    for (const c of unscored) {
      try {
        await this.scoreOrder(c.id);
        scored++;
      } catch (err) {
        failedIds.push(c.id);
        this.logger.error(
          `Backfill failed for order ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    for (const c of stale) {
      try {
        await this.scoreOrder(c.id);
        staleRescored++;
      } catch (err) {
        failedIds.push(c.id);
        this.logger.error(
          `Stale-rescore failed for order ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    // Phase 174 (audit #225) — return the failed count + ids so the
    // SUPER_ADMIN sees what didn't score instead of a bare success count.
    return {
      scored,
      staleRescored,
      failed: failedIds.length,
      failedIds,
      candidateCount,
      dryRun: false,
    };
  }

  /**
   * Re-score a single order on demand. Useful when a verifier wants a
   * fresh signal after a customer-data change (e.g. address update) or
   * when investigating why an order landed in a particular band.
   *
   * Phase 71 (audit Gap #9) — `scoredBy` records which admin called
   * the rescore. The verification controller wires its req.adminId in.
   */
  async rescore(orderId: string, adminId?: string): Promise<RiskScore> {
    return this.scoreOrder(orderId, {
      source: 'MANUAL',
      scoredBy: adminId,
    });
  }
}

/* ── Pure scoring function ─────────────────────────────────────────── */

interface ScoreInput {
  priorOrderCount: number;
  goodsAmount: number;
  itemCount: number;
  paymentMethod: string;
  paymentStatus: string;
  shippingPincode: string | null;
  customerEmail: string | null;
  cancellationRate: number | null;
  cancellationsInWindow: number;
  priorInWindow: number;
  recentOrderCount: number;
}

type RuleResolved = {
  scoreDelta: number;
  config: Record<string, any>;
  enabled: boolean;
  maskAmounts: boolean;
};

/**
 * Phase 72 (audit Gap #17) — bucketize amounts when the rule's
 * maskAmounts flag is true. Used by HIGH_VALUE / VERY_HIGH_VALUE
 * reasons so a less-privileged admin tier doesn't see the
 * customer's exact order value in the reason text.
 */
function fmtAmount(rupees: number, mask: boolean): string {
  if (!mask) return `₹${Math.round(rupees).toLocaleString('en-IN')}`;
  if (rupees >= 100_000) return '≥₹1L';
  if (rupees >= 50_000) return '≥₹50K';
  if (rupees >= 25_000) return '≥₹25K';
  if (rupees >= 10_000) return '≥₹10K';
  return '<₹10K';
}

function resolve(
  rules: Record<OrderRiskReasonCodeKey, RuleResolved> | null,
  code: OrderRiskReasonCodeKey,
  fallback: { scoreDelta: number; config?: Record<string, any> },
): RuleResolved | null {
  if (!rules) {
    // No DB cache available — use in-code default; assume enabled.
    return {
      scoreDelta: fallback.scoreDelta,
      config: fallback.config ?? {},
      enabled: true,
      maskAmounts: false,
    };
  }
  const r = rules[code];
  if (!r || !r.enabled) return null;
  return r;
}

function computeScore(
  input: ScoreInput,
  rules: Record<OrderRiskReasonCodeKey, RuleResolved> | null,
): RiskScore {
  let score = 0;
  const reasonRows: RiskReasonRow[] = [];
  const push = (code: OrderRiskReasonCode, text: string, scoreDelta: number) => {
    reasonRows.push({ code, text, scoreDelta });
    score += scoreDelta;
  };

  // Rule: customer history.
  if (input.priorOrderCount === 0) {
    const r = resolve(rules, 'FIRST_TIME_CUSTOMER', { scoreDelta: 5 });
    if (r) push('FIRST_TIME_CUSTOMER', 'First-time customer', r.scoreDelta);
  } else {
    const r = resolve(rules, 'REPEAT_CUSTOMER', { scoreDelta: -10 });
    if (r) push(
      'REPEAT_CUSTOMER',
      `Repeat customer (${input.priorOrderCount} prior order${input.priorOrderCount === 1 ? '' : 's'})`,
      r.scoreDelta,
    );
  }

  // Rule: payment method + capture state.
  //
  // Phase 72 (2026-05-22) — Phase 71 audit Gap #14. The COD_PAYMENT
  // delta deliberately coexists with the CodRuleEngine at place-
  // order. The two systems classify COD risk independently with
  // complementary roles:
  //
  //   • CodRuleEngine — "can we offer COD here AT ALL?" Pincode +
  //     customer-tier + value-band hard gates evaluated pre-tx.
  //     An ineligible order throws and never reaches verification.
  //
  //   • This rule — "now that COD passed eligibility, how risky
  //     is this specific COD order for chargeback / refusal?"
  //     Additive signal that combines with first-time-customer,
  //     value, velocity, etc. into the verification band.
  //
  // The two together let ops express "block everyone in this
  // pincode from COD" (CodRuleEngine) AND "give verifier a heads-
  // up that this otherwise-eligible COD looks fraud-shaped"
  // (this rule). Sharing computation between them is rejected
  // because the inputs differ (CodRuleEngine reads cod_rules +
  // tier; risk-scoring reads order + customer history).
  if (input.paymentMethod === 'COD') {
    const r = resolve(rules, 'COD_PAYMENT', { scoreDelta: 5 });
    if (r) push('COD_PAYMENT', 'COD payment (chargeback / refusal risk)', r.scoreDelta);
  } else if (input.paymentStatus === 'PAID') {
    const r = resolve(rules, 'ONLINE_CAPTURED', { scoreDelta: -5 });
    if (r) push('ONLINE_CAPTURED', 'Online payment captured', r.scoreDelta);
  } else {
    const r = resolve(rules, 'ONLINE_NOT_CAPTURED', { scoreDelta: 10 });
    if (r) push(
      'ONLINE_NOT_CAPTURED',
      `Online payment not captured (status=${input.paymentStatus})`,
      r.scoreDelta,
    );
  }

  // Rule: goods value (shipping excluded — audit Gap #13).
  // Phase 72 (audit Gap #17) — maskAmounts elides exact value.
  const veryHigh = resolve(rules, 'VERY_HIGH_VALUE', {
    scoreDelta: 20,
    config: { valueRupees: VERY_HIGH_VALUE_THRESHOLD },
  });
  const high = resolve(rules, 'HIGH_VALUE', {
    scoreDelta: 10,
    config: { valueRupees: HIGH_VALUE_THRESHOLD },
  });
  const veryHighThreshold = Number(veryHigh?.config?.valueRupees ?? VERY_HIGH_VALUE_THRESHOLD);
  const highThreshold = Number(high?.config?.valueRupees ?? HIGH_VALUE_THRESHOLD);
  if (veryHigh && input.goodsAmount >= veryHighThreshold) {
    push(
      'VERY_HIGH_VALUE',
      `Very high value order (${fmtAmount(input.goodsAmount, veryHigh.maskAmounts)})`,
      veryHigh.scoreDelta,
    );
  } else if (high && input.goodsAmount >= highThreshold) {
    push(
      'HIGH_VALUE',
      `High value order (${fmtAmount(input.goodsAmount, high.maskAmounts)})`,
      high.scoreDelta,
    );
  }

  // Rule: bulk cart.
  const bulk = resolve(rules, 'BULK_ORDER', {
    scoreDelta: 5,
    config: { itemThreshold: BULK_ITEM_THRESHOLD },
  });
  const bulkThreshold = Number(bulk?.config?.itemThreshold ?? BULK_ITEM_THRESHOLD);
  if (bulk && input.itemCount >= bulkThreshold) {
    push('BULK_ORDER', `Bulk order (${input.itemCount} items)`, bulk.scoreDelta);
  }

  // Phase 71 (audit Gap #11) — pincode RTO history.
  // Phase 72 — pincode list comes from rule config (legacy static
  // set retained as belt-and-braces fallback).
  const pincode = resolve(rules, 'PINCODE_RTO', {
    scoreDelta: 10,
    config: { pincodes: [...HIGH_RTO_PINCODES] },
  });
  if (pincode && input.shippingPincode) {
    const list: string[] = Array.isArray(pincode.config?.pincodes)
      ? pincode.config.pincodes
      : [...HIGH_RTO_PINCODES];
    if (list.includes(input.shippingPincode) || HIGH_RTO_PINCODES.has(input.shippingPincode)) {
      push(
        'PINCODE_RTO',
        `Pincode ${input.shippingPincode} has high RTO history`,
        pincode.scoreDelta,
      );
    }
  }

  // Phase 71 (audit Gap #11) — cancellation history.
  const cancellation = resolve(rules, 'CANCELLATION_HISTORY', {
    scoreDelta: 15,
    config: {
      minPrior: CANCELLATION_MIN_PRIOR,
      lookbackDays: CANCELLATION_LOOKBACK_DAYS,
      rateThreshold: CANCELLATION_RATE_THRESHOLD,
    },
  });
  if (cancellation) {
    const rateThreshold = Number(cancellation.config?.rateThreshold ?? CANCELLATION_RATE_THRESHOLD);
    const lookbackDays = Number(cancellation.config?.lookbackDays ?? CANCELLATION_LOOKBACK_DAYS);
    if (
      input.cancellationRate !== null &&
      input.cancellationRate > rateThreshold
    ) {
      push(
        'CANCELLATION_HISTORY',
        `Customer cancelled ${input.cancellationsInWindow}/${input.priorInWindow} prior orders (last ${lookbackDays}d)`,
        cancellation.scoreDelta,
      );
    }
  }

  // Phase 71 (audit Gap #11) — suspicious email (disposable domain).
  // Phase 72 — domain list comes from rule config.
  const susEmail = resolve(rules, 'SUSPICIOUS_EMAIL', {
    scoreDelta: 10,
    config: { domains: [...DISPOSABLE_EMAIL_DOMAINS] },
  });
  if (susEmail && input.customerEmail) {
    const domain = input.customerEmail.toLowerCase().split('@')[1] ?? '';
    const list: string[] = Array.isArray(susEmail.config?.domains)
      ? susEmail.config.domains
      : [...DISPOSABLE_EMAIL_DOMAINS];
    if (domain && (list.includes(domain) || DISPOSABLE_EMAIL_DOMAINS.has(domain))) {
      push(
        'SUSPICIOUS_EMAIL',
        `Email from known disposable domain (${domain})`,
        susEmail.scoreDelta,
      );
    }
  }

  // Phase 71 (audit Gap #11) — velocity.
  const velocity = resolve(rules, 'VELOCITY', {
    scoreDelta: 10,
    config: { windowMinutes: VELOCITY_LOOKBACK_MINUTES, threshold: VELOCITY_THRESHOLD },
  });
  if (velocity) {
    const threshold = Number(velocity.config?.threshold ?? VELOCITY_THRESHOLD);
    const windowMinutes = Number(velocity.config?.windowMinutes ?? VELOCITY_LOOKBACK_MINUTES);
    if (input.recentOrderCount > threshold) {
      push(
        'VELOCITY',
        `Customer placed ${input.recentOrderCount} orders in last ${windowMinutes} min`,
        velocity.scoreDelta,
      );
    }
  }

  const band: RiskBand =
    score <= BAND_THRESHOLDS.GREEN_MAX
      ? 'GREEN'
      : score <= BAND_THRESHOLDS.YELLOW_MAX
        ? 'YELLOW'
        : score <= BAND_THRESHOLDS.RED_MAX
          ? 'RED'
          : 'CRITICAL';

  return {
    score,
    band,
    reasonRows,
    reasons: reasonRows.map((r) => r.text),
  };
}
