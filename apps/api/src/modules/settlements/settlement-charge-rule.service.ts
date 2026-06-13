import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import type { CreateSettlementChargeRuleDto } from './dtos/settlement-charge-rule.dto';

/**
 * Settlement tax/charge rule master (dynamic charges). CRUD for the
 * admin-configurable rules a super-admin defines (name, rate, base).
 *
 * NOTE: this owns the rule MASTER only. The settlement calculation/ledger
 * that consumes these rules is a later phase — creating rules here does not
 * yet change any seller payout.
 */
@Injectable()
export class SettlementChargeRuleService {
  constructor(private readonly prisma: PrismaService) {}

  /** All rules, ordered by calculation priority then creation. */
  async list() {
    return this.prisma.settlementChargeRule.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Active rules effective at `asOf` — the set a settlement cycle snapshots. */
  async listActive(asOf: Date) {
    return this.prisma.settlementChargeRule.findMany({
      where: {
        status: 'ACTIVE',
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(input: CreateSettlementChargeRuleDto, actor: string) {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('Rule name is required.');
    }
    if (!Number.isInteger(input.rateBps) || input.rateBps < 0) {
      throw new BadRequestException('Rate must be a whole number ≥ 0 (basis points).');
    }

    let baseRuleId: string | null = null;
    if (input.baseType === 'RULE') {
      if (!input.baseRuleId) {
        throw new BadRequestException(
          'baseRuleId is required when the rule is levied on another rule.',
        );
      }
      const base = await this.prisma.settlementChargeRule.findUnique({
        where: { id: input.baseRuleId },
      });
      if (!base) {
        throw new BadRequestException('Selected base rule not found.');
      }
      baseRuleId = input.baseRuleId;
      // A brand-new rule has no id yet and nothing references it, so it cannot
      // close a cycle on create. (Cycle detection matters once edits to an
      // existing rule's base are allowed — added with the update endpoint.)
    }

    // No two ACTIVE rules may share a name (case-insensitive).
    const dup = await this.prisma.settlementChargeRule.findFirst({
      where: { status: 'ACTIVE', name: { equals: name, mode: 'insensitive' } },
    });
    if (dup) {
      throw new ConflictException(`An active rule named "${name}" already exists.`);
    }

    return this.prisma.settlementChargeRule.create({
      data: {
        name,
        rateBps: input.rateBps,
        baseType: input.baseType,
        baseRuleId,
        createdBy: actor,
        updatedBy: actor,
      },
    });
  }

  /**
   * Delete a charge rule. It stops applying to NEW settlement cycles. Past
   * settlements keep their frozen charge lines (those denormalize the rule
   * name/rate/amount and only hold `ruleId` for traceability — no FK — so a
   * delete never destroys settlement history).
   *
   * Blocked when another rule is levied on this one (`baseRuleId`), otherwise
   * that dependent would silently compute ₹0 on its base in new cycles.
   */
  async delete(id: string) {
    const rule = await this.prisma.settlementChargeRule.findUnique({
      where: { id },
    });
    if (!rule) {
      throw new BadRequestException('Charge rule not found.');
    }

    const dependent = await this.prisma.settlementChargeRule.findFirst({
      where: { baseRuleId: id },
    });
    if (dependent) {
      throw new ConflictException(
        `Cannot delete "${rule.name}" — the rule "${dependent.name}" is levied on it. Delete or edit "${dependent.name}" first.`,
      );
    }

    await this.prisma.settlementChargeRule.delete({ where: { id } });
    return { id };
  }
}
