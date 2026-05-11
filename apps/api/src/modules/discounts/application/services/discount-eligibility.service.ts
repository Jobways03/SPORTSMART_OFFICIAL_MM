// Phase E (P1.3) — Discount eligibility service.
//
// Bridge between the pure evaluator (domain layer) and Prisma data
// (customer + cart + redemption history). Two responsibilities:
//
//   1. Load eligibility rules for a discount.
//   2. Build the EligibilityContext from the customer + cart shape
//      passed in by the caller, plus optional history lookups.
//
// Caller (discounts.service.ts) is responsible for SUPPLYING the
// cart shape. We don't reach into the cart module here — keeps
// dependencies minimal and the service unit-testable in isolation.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { evaluateEligibility } from '../../domain/eligibility/evaluate';
import type {
  EligibilityContext,
  EligibilityRule,
  EligibilityVerdict,
} from '../../domain/eligibility/types';

export interface EligibilityCheckArgs {
  discountId: string;
  customerId: string;
  /** Cart shape — caller already loaded from session/repo. */
  cart?: EligibilityContext['cart'];
}

@Injectable()
export class DiscountEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run all eligibility rules for a discount against the given
   * customer + cart. Returns the verdict; caller throws a customer-
   * friendly error using `verdict.reason` when `allowed === false`.
   *
   * Empty rule list → allowed (legacy compat — discounts without
   * rules behave exactly as before).
   */
  async check(args: EligibilityCheckArgs): Promise<EligibilityVerdict> {
    const rules = await this.loadRules(args.discountId);
    if (rules.length === 0) return { allowed: true };

    const ctx = await this.buildContext({
      discountId: args.discountId,
      customerId: args.customerId,
      cart: args.cart,
      rules,
    });
    return evaluateEligibility(rules, ctx);
  }

  /**
   * Load rules from the DB. Public so admin endpoints can list
   * the configured rules on a discount.
   */
  async loadRules(discountId: string): Promise<EligibilityRule[]> {
    const rows = await this.prisma.discountEligibilityRule.findMany({
      where: { discountId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      ruleType: r.ruleType,
      valueJson: (r.valueJson as Record<string, unknown>) ?? {},
    }));
  }

  /**
   * Build the EligibilityContext. Only loads what the configured
   * rules actually need — keeps DB roundtrips minimal for the
   * common case where a discount has just 1–2 rules.
   */
  private async buildContext(args: {
    discountId: string;
    customerId: string;
    cart?: EligibilityContext['cart'];
    rules: ReadonlyArray<EligibilityRule>;
  }): Promise<EligibilityContext> {
    const ctx: EligibilityContext = { cart: args.cart };
    const ruleTypes = new Set(args.rules.map((r) => r.ruleType));

    const needsCustomer =
      ruleTypes.has('FIRST_ORDER_ONLY') ||
      ruleTypes.has('NEW_CUSTOMER_ONLY') ||
      ruleTypes.has('CUSTOMER_TIER_IN') ||
      ruleTypes.has('CUSTOMER_SEGMENT_IN');

    const needsHistory =
      ruleTypes.has('MAX_REDEMPTIONS_PER_CUSTOMER') ||
      ruleTypes.has('MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW') ||
      ruleTypes.has('MIN_DAYS_BETWEEN_REDEMPTIONS');

    const promises: Array<Promise<void>> = [];

    if (needsCustomer) {
      promises.push(this.loadCustomer(args.customerId, ctx));
    }
    if (needsHistory) {
      promises.push(this.loadRedemptionHistory(args, ctx));
    }

    await Promise.all(promises);
    return ctx;
  }

  private async loadCustomer(
    customerId: string,
    ctx: EligibilityContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        createdAt: true,
        // tier / segments not on the User model in the current
        // schema — left undefined so the rules SKIP rather than
        // reject. When a loyalty module adds those fields, add
        // them to the select here and the rules light up.
      },
    });
    if (!user) return;

    const paidOrderCount = await this.prisma.masterOrder.count({
      where: {
        customerId,
        paymentStatus: 'PAID' as any,
      },
    });

    const accountAgeDays = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000),
    );

    ctx.customer = {
      id: user.id,
      paidOrderCount,
      accountAgeDays,
      // tier / segments stay undefined — rules skip
    };
  }

  private async loadRedemptionHistory(
    args: { discountId: string; customerId: string },
    ctx: EligibilityContext,
  ): Promise<void> {
    const rows = await this.prisma.discountRedemption.findMany({
      where: {
        discountId: args.discountId,
        customerId: args.customerId,
        status: 'REDEEMED',
      },
      select: { redeemedAt: true },
      orderBy: { redeemedAt: 'desc' },
      take: 100, // velocity rules don't need more than this
    });
    ctx.redemptionHistory = rows
      .filter((r): r is { redeemedAt: Date } => r.redeemedAt !== null)
      .map((r) => ({ redeemedAt: r.redeemedAt }));
  }

  /**
   * Admin: replace the rule set on a discount in one shot. Cascade
   * removes the old rows; create-many writes the new set. Used by
   * the discount form when admin edits the Eligibility section.
   */
  async setRules(
    discountId: string,
    rules: ReadonlyArray<EligibilityRule>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.discountEligibilityRule.deleteMany({
        where: { discountId },
      });
      if (rules.length > 0) {
        await tx.discountEligibilityRule.createMany({
          data: rules.map((r) => ({
            discountId,
            ruleType: r.ruleType,
            valueJson: r.valueJson as any,
          })),
        });
      }
    });
  }
}
