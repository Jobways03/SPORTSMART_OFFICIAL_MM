import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';

export type RiskBand = 'GREEN' | 'YELLOW' | 'RED';

export interface RiskScore {
  score: number;
  band: RiskBand;
  reasons: string[];
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
 * If you change the rules, run POST /admin/verification/backfill-scores
 * to re-score all PLACED orders so the queue reflects the new logic.
 */
const HIGH_VALUE_THRESHOLD = 10_000;
const VERY_HIGH_VALUE_THRESHOLD = 25_000;
const BULK_ITEM_THRESHOLD = 10;

const BAND_THRESHOLDS = {
  GREEN_MAX: 0,
  YELLOW_MAX: 14,
};

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
  ) {}

  /**
   * Compute and persist the risk score for a single order. Idempotent —
   * called multiple times for the same order will overwrite with the
   * latest computation. Returns the resulting band so callers can act
   * on it (e.g. include in claim-next response).
   */
  async scoreOrder(orderId: string): Promise<RiskScore> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        totalAmount: true,
        itemCount: true,
        paymentMethod: true,
        paymentStatus: true,
      },
    });
    if (!order) throw new NotFoundAppException('Order not found');

    // Count prior orders this customer has had (any status — including
    // delivered, cancelled, etc.) excluding this one. Anything > 0 marks
    // them as a repeat customer.
    const priorOrderCount = await this.prisma.masterOrder.count({
      where: {
        customerId: order.customerId,
        id: { not: order.id },
      },
    });

    const result = computeScore({
      priorOrderCount,
      totalAmount: Number(order.totalAmount),
      itemCount: order.itemCount,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    });

    await this.prisma.masterOrder.update({
      where: { id: orderId },
      data: this.moneyDualWrite.applyPaise('masterOrder', {
        verificationRiskScore: result.score,
        verificationRiskBand: result.band,
        verificationRiskReasons: result.reasons,
        verificationScoredAt: new Date(),
      }),
    });

    this.logger.log(
      `Scored order ${orderId}: ${result.band} (${result.score}) — ${result.reasons.join(', ')}`,
    );
    return result;
  }

  /**
   * One-shot backfill of every PLACED order whose risk score has never
   * been computed (or that was created before this feature shipped).
   * Safe to re-run; uses the same scoreOrder path so future-loaded rules
   * apply uniformly. Returns the number scored.
   */
  async backfillUnscored(): Promise<{ scored: number }> {
    const candidates = await this.prisma.masterOrder.findMany({
      where: {
        orderStatus: 'PLACED',
        verificationRiskBand: null,
      },
      select: { id: true },
    });

    let scored = 0;
    for (const c of candidates) {
      try {
        await this.scoreOrder(c.id);
        scored++;
      } catch (err) {
        this.logger.error(
          `Backfill failed for order ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    return { scored };
  }

  /**
   * Re-score a single order on demand. Useful when a verifier wants a
   * fresh signal after a customer-data change (e.g. address update) or
   * when investigating why an order landed in a particular band.
   */
  async rescore(orderId: string): Promise<RiskScore> {
    return this.scoreOrder(orderId);
  }
}

/* ── Pure scoring function ─────────────────────────────────────────── */

interface ScoreInput {
  priorOrderCount: number;
  totalAmount: number;
  itemCount: number;
  paymentMethod: string;
  paymentStatus: string;
}

function computeScore(input: ScoreInput): RiskScore {
  let score = 0;
  const reasons: string[] = [];

  // Rule: customer history.
  if (input.priorOrderCount === 0) {
    score += 5;
    reasons.push('First-time customer');
  } else {
    score -= 10;
    reasons.push(`Repeat customer (${input.priorOrderCount} prior order${input.priorOrderCount === 1 ? '' : 's'})`);
  }

  // Rule: payment method + capture state.
  if (input.paymentMethod === 'COD') {
    score += 5;
    reasons.push('COD payment (chargeback / refusal risk)');
  } else if (input.paymentStatus === 'PAID') {
    score -= 5;
    reasons.push('Online payment captured');
  } else {
    score += 10;
    reasons.push(`Online payment not captured (status=${input.paymentStatus})`);
  }

  // Rule: order value.
  if (input.totalAmount >= VERY_HIGH_VALUE_THRESHOLD) {
    score += 20;
    reasons.push(`Very high value order (₹${input.totalAmount})`);
  } else if (input.totalAmount >= HIGH_VALUE_THRESHOLD) {
    score += 10;
    reasons.push(`High value order (₹${input.totalAmount})`);
  }

  // Rule: bulk cart.
  if (input.itemCount >= BULK_ITEM_THRESHOLD) {
    score += 5;
    reasons.push(`Bulk order (${input.itemCount} items)`);
  }

  const band: RiskBand =
    score <= BAND_THRESHOLDS.GREEN_MAX
      ? 'GREEN'
      : score <= BAND_THRESHOLDS.YELLOW_MAX
        ? 'YELLOW'
        : 'RED';

  return { score, band, reasons };
}
