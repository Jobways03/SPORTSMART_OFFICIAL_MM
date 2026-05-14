import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { CodRuleEngine } from '../services/cod-rule-engine.service';

@Injectable()
export class CodPublicFacade {
  private readonly logger = new Logger(CodPublicFacade.name);
  // Resolved at construction so the read is hot-path-cheap. These are
  // guardrails — admin-editable cod_rules still own the dynamic policy.
  private readonly fallbackMaxOrderValueInr: number;
  private readonly fallbackMinOrderValueInr: number;
  private readonly abuseRecentCancelLimit: number;
  private readonly abuseLookbackMs: number;

  constructor(
    private readonly prisma: PrismaService,
    // Sprint cleanup 2026-05-13 — delegate to admin-editable rules
    // first. Story 1.4 originally wired CodRuleEngine into checkout
    // directly; this facade now uses the same engine so other
    // consumers don't bypass admin overrides.
    private readonly ruleEngine: CodRuleEngine,
    private readonly env: EnvService,
  ) {
    this.fallbackMaxOrderValueInr = this.env.getNumber('COD_FALLBACK_MAX_ORDER_VALUE_INR', 10000);
    this.fallbackMinOrderValueInr = this.env.getNumber('COD_FALLBACK_MIN_ORDER_VALUE_INR', 100);
    this.abuseRecentCancelLimit = this.env.getNumber('COD_ABUSE_RECENT_CANCEL_LIMIT', 3);
    const lookbackDays = this.env.getNumber('COD_ABUSE_LOOKBACK_DAYS', 30);
    this.abuseLookbackMs = Math.round(lookbackDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Evaluate whether COD is allowed for a given order context.
   *
   * Routes through `CodRuleEngine.evaluate` (the admin-editable rule
   * set) first. If the engine returns ineligible, surface the rule's
   * reason. Otherwise apply the legacy seller-active + serviceability
   * + abuse-counter checks below as additional guards.
   */
  async evaluateCodEligibility(params: {
    customerId: string;
    sellerId: string;
    orderValue: number;
    pincode: string;
  }): Promise<{ allowed: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    // Sprint cleanup 2026-05-13 — admin-editable rules take precedence.
    // Engine auto-logs the decision to cod_decision_log.
    const ruleVerdict = await this.ruleEngine.evaluate({
      pincode: params.pincode,
      sellerId: params.sellerId,
      customerId: params.customerId,
      orderTotalInr: params.orderValue,
    });
    if (!ruleVerdict.eligible) {
      reasons.push(ruleVerdict.reason ?? 'Blocked by COD rule engine');
      // Continue collecting legacy reasons too — useful for ops to see
      // every blocker at once instead of a one-at-a-time peel-off.
    }

    // Rule 1: Order value range (env-driven guardrail layered on top of
    // the admin rule engine above. Engine should usually handle this via
    // a VALUE_LIMIT rule; these are the absolute outer bounds).
    if (params.orderValue > this.fallbackMaxOrderValueInr) {
      reasons.push(`Order value exceeds COD limit of ₹${this.fallbackMaxOrderValueInr}`);
    }
    if (params.orderValue < this.fallbackMinOrderValueInr) {
      reasons.push(`Order value below COD minimum of ₹${this.fallbackMinOrderValueInr}`);
    }

    // Rule 2: Check if seller supports COD
    const seller = await this.prisma.seller.findUnique({
      where: { id: params.sellerId },
      select: { status: true },
    });
    if (!seller || seller.status !== 'ACTIVE') {
      reasons.push('Seller is not active');
    }

    // Rule 3: Check pincode serviceability for COD
    const serviceability = await this.prisma.sellerServiceArea.findFirst({
      where: {
        sellerId: params.sellerId,
        pincode: params.pincode,
        isActive: true,
      },
    });
    if (!serviceability) {
      reasons.push('Pincode not serviceable by this seller');
    }

    // Rule 4: Customer COD abuse counter — N cancellations in M days.
    // Both N and M come from env so risk team can dial them per market.
    const recentCodOrders = await this.prisma.masterOrder.count({
      where: {
        customerId: params.customerId,
        paymentMethod: 'COD',
        orderStatus: 'CANCELLED',
        createdAt: { gte: new Date(Date.now() - this.abuseLookbackMs) },
      },
    });
    if (recentCodOrders >= this.abuseRecentCancelLimit) {
      const days = Math.round(this.abuseLookbackMs / (24 * 60 * 60 * 1000));
      reasons.push(`Too many cancelled COD orders in the last ${days} days`);
    }

    const allowed = reasons.length === 0;

    this.logger.log(
      `COD eligibility for customer ${params.customerId}: ${allowed ? 'ALLOWED' : 'BLOCKED'} (${reasons.length} reasons)`,
    );

    return { allowed, reasons };
  }

  /**
   * Log a COD decision for audit purposes.
   */
  async logCodDecision(decisionData: {
    orderId: string;
    customerId: string;
    allowed: boolean;
    reasons: string[];
    orderValue: number;
  }): Promise<void> {
    this.logger.log(
      `COD decision logged for order ${decisionData.orderId}: ${decisionData.allowed ? 'ALLOWED' : 'BLOCKED'}`,
    );
  }

  /**
   * Get all available COD reason codes. Descriptions reflect the live
   * env-tuned thresholds so admins surfacing this list see the current
   * policy, not stale hardcoded values.
   */
  async getReasonCodes(): Promise<{ code: string; description: string }[]> {
    return [
      { code: 'ORDER_VALUE_TOO_HIGH', description: `Order value exceeds COD limit of ₹${this.fallbackMaxOrderValueInr}` },
      { code: 'ORDER_VALUE_TOO_LOW', description: `Order value below COD minimum of ₹${this.fallbackMinOrderValueInr}` },
      { code: 'SELLER_INACTIVE', description: 'Seller is not active' },
      { code: 'PINCODE_NOT_SERVICEABLE', description: 'Delivery pincode is not serviceable' },
      { code: 'COD_ABUSE_DETECTED', description: 'Too many cancelled COD orders recently' },
    ];
  }
}
