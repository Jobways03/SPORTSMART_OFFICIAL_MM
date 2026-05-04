import { Injectable } from '@nestjs/common';
import type { CodRule, CodRuleKind } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export interface CodEvaluationInput {
  pincode: string;
  sellerId?: string;
  customerId?: string;
  orderTotalInr: number;
}

export interface CodEvaluationResult {
  eligible: boolean;
  decidedBy: string;
  reason?: string;
}

/**
 * Evaluates ordered CodRule rows and short-circuits on the first
 * matching rule. Default = allow when no rule matches.
 */
@Injectable()
export class CodRuleEngine {
  constructor(private readonly prisma: PrismaService) {}

  async listRules() {
    return this.prisma.codRule.findMany({
      orderBy: [{ active: 'desc' }, { priority: 'asc' }],
    });
  }

  async createRule(args: {
    kind: CodRuleKind;
    priority?: number;
    conditions: any;
    active?: boolean;
    description?: string;
  }) {
    return this.prisma.codRule.create({
      data: {
        kind: args.kind,
        priority: args.priority ?? 100,
        conditions: args.conditions,
        active: args.active ?? true,
        description: args.description ?? null,
      },
    });
  }

  async updateRule(id: string, args: Partial<{
    priority: number;
    conditions: any;
    active: boolean;
    description: string;
  }>) {
    return this.prisma.codRule.update({ where: { id }, data: args });
  }

  async deleteRule(id: string) {
    return this.prisma.codRule.delete({ where: { id } });
  }

  async evaluate(input: CodEvaluationInput): Promise<CodEvaluationResult> {
    const rules = await this.prisma.codRule.findMany({
      where: { active: true },
      orderBy: { priority: 'asc' },
    });

    for (const rule of rules) {
      const decision = this.matchRule(rule, input);
      if (decision) {
        await this.logDecision(input, decision);
        return decision;
      }
    }

    const fallback: CodEvaluationResult = {
      eligible: true,
      decidedBy: 'default-allow',
    };
    await this.logDecision(input, fallback);
    return fallback;
  }

  private matchRule(rule: CodRule, input: CodEvaluationInput): CodEvaluationResult | null {
    const c: any = rule.conditions ?? {};
    switch (rule.kind) {
      case 'PINCODE_DENY': {
        const list: string[] = c.pincodes ?? [];
        if (list.includes(input.pincode)) {
          return { eligible: false, decidedBy: rule.id, reason: `Pincode ${input.pincode} is on the COD-deny list` };
        }
        return null;
      }
      case 'PINCODE_ALLOW': {
        // Only match if condition explicitly allows; doesn't deny others.
        // Used as a positive override when paired with a default-deny.
        const list: string[] = c.pincodes ?? [];
        if (list.includes(input.pincode)) {
          return { eligible: true, decidedBy: rule.id, reason: `Pincode ${input.pincode} explicitly allowed` };
        }
        return null;
      }
      case 'VALUE_LIMIT': {
        const max: number = c.maxValueInr ?? Infinity;
        if (input.orderTotalInr > max) {
          return { eligible: false, decidedBy: rule.id, reason: `Order ₹${input.orderTotalInr} exceeds COD cap ₹${max}` };
        }
        return null;
      }
      case 'SELLER_DENY': {
        const list: string[] = c.sellerIds ?? [];
        if (input.sellerId && list.includes(input.sellerId)) {
          return { eligible: false, decidedBy: rule.id, reason: 'Seller is COD-disabled' };
        }
        return null;
      }
      case 'CUSTOMER_RISK': {
        const list: string[] = c.customerIds ?? [];
        if (input.customerId && list.includes(input.customerId)) {
          return { eligible: false, decidedBy: rule.id, reason: 'Customer flagged as high COD risk' };
        }
        return null;
      }
    }
    return null;
  }

  private async logDecision(input: CodEvaluationInput, result: CodEvaluationResult) {
    await this.prisma.codDecisionLog.create({
      data: {
        customerId: input.customerId,
        pincode: input.pincode,
        sellerId: input.sellerId,
        orderTotalInr: input.orderTotalInr,
        eligible: result.eligible,
        decidedBy: result.decidedBy,
        reason: result.reason,
      },
    });
  }

  async listDecisions(args: { eligible?: boolean; limit?: number }) {
    return this.prisma.codDecisionLog.findMany({
      where: args.eligible === undefined ? {} : { eligible: args.eligible },
      orderBy: { createdAt: 'desc' },
      take: Math.min(args.limit ?? 100, 500),
    });
  }
}
