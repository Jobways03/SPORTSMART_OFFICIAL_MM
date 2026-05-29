// Phase 37 — HsnMasterService.
//
// CRUD for the CBIC HSN code master. Versioned by (hsnCode,
// effectiveFrom): rate changes mid-year add a new row rather than
// rewrite the old one, preserving the snapshot semantics that
// OrderTaxLineSnapshot relies on.
//
// Write paths automatically deactivate the prior active row for the
// same code by setting its effectiveTo = the new row's effectiveFrom
// — minus one millisecond is overkill; we leave them touching so the
// audit log shows the exact handover instant.
//
// CA actions: see docs/tax/HSN_RATE_POLICY.md §7.

import { Injectable } from '@nestjs/common';
import type { SupplyTaxability } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

export interface HsnMasterListItem {
  id: string;
  hsnCode: string;
  description: string;
  defaultGstRateBps: number;
  supplyTaxability: SupplyTaxability;
  defaultUqcCode: string | null;
  categoryHint: string | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHsnInput {
  hsnCode: string;
  description: string;
  defaultGstRateBps: number;
  supplyTaxability?: SupplyTaxability;
  defaultUqcCode?: string | null;
  categoryHint?: string | null;
  // ISO date string. When supplied, defaults to "now".
  effectiveFrom?: string;
}

export interface UpdateHsnInput {
  description?: string;
  defaultUqcCode?: string | null;
  categoryHint?: string | null;
  isActive?: boolean;
  effectiveTo?: string | null;
}

const HSN_CODE_RE = /^[0-9]{4,8}$/;
const MAX_RATE_BPS = 4000;

@Injectable()
export class HsnMasterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: { search?: string; activeOnly?: boolean }): Promise<HsnMasterListItem[]> {
    const where: Record<string, unknown> = {};
    if (filter.activeOnly) where.isActive = true;
    if (filter.search) {
      where.OR = [
        { hsnCode: { contains: filter.search } },
        { description: { contains: filter.search, mode: 'insensitive' } },
        { categoryHint: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.hsnMaster.findMany({
      where,
      orderBy: [{ hsnCode: 'asc' }, { effectiveFrom: 'desc' }],
      take: 500,
    });
    return rows.map(toListItem);
  }

  async create(input: CreateHsnInput, _actor: string): Promise<HsnMasterListItem> {
    this.validateCode(input.hsnCode);
    this.validateRate(input.defaultGstRateBps);
    const effectiveFrom = input.effectiveFrom
      ? new Date(input.effectiveFrom)
      : new Date();
    if (isNaN(effectiveFrom.getTime())) {
      throw new BadRequestAppException('effectiveFrom is not a valid date');
    }

    return this.prisma.$transaction(async (tx) => {
      // Close out any currently-active row for the same code: set
      // effectiveTo = new effectiveFrom. Multiple historical rows can
      // exist; only the one whose window includes the new boundary
      // needs closing.
      await tx.hsnMaster.updateMany({
        where: {
          hsnCode: input.hsnCode,
          isActive: true,
          effectiveTo: null,
        },
        data: { effectiveTo: effectiveFrom },
      });

      const row = await tx.hsnMaster.create({
        data: {
          hsnCode: input.hsnCode,
          description: input.description,
          defaultGstRateBps: input.defaultGstRateBps,
          supplyTaxability: input.supplyTaxability ?? 'TAXABLE',
          defaultUqcCode: input.defaultUqcCode ?? null,
          categoryHint: input.categoryHint ?? null,
          effectiveFrom,
          isActive: true,
        },
      });
      return toListItem(row);
    });
  }

  async update(id: string, input: UpdateHsnInput, _actor: string): Promise<HsnMasterListItem> {
    const existing = await this.prisma.hsnMaster.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('HSN row not found');
    const data: Record<string, unknown> = {};
    if (input.description !== undefined) data.description = input.description;
    if (input.defaultUqcCode !== undefined)
      data.defaultUqcCode = input.defaultUqcCode;
    if (input.categoryHint !== undefined)
      data.categoryHint = input.categoryHint;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.effectiveTo !== undefined) {
      data.effectiveTo =
        input.effectiveTo === null ? null : new Date(input.effectiveTo);
    }
    const updated = await this.prisma.hsnMaster.update({
      where: { id },
      data,
    });
    return toListItem(updated);
  }

  private validateCode(code: string) {
    if (!HSN_CODE_RE.test(code)) {
      throw new BadRequestAppException(
        'HSN code must be 4-8 digits per CBIC harmonised system',
      );
    }
  }

  private validateRate(bps: number) {
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_RATE_BPS) {
      throw new BadRequestAppException(
        `defaultGstRateBps must be an integer between 0 and ${MAX_RATE_BPS}`,
      );
    }
  }
}

function toListItem(row: {
  id: string;
  hsnCode: string;
  description: string;
  defaultGstRateBps: number;
  supplyTaxability: SupplyTaxability;
  defaultUqcCode: string | null;
  categoryHint: string | null;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): HsnMasterListItem {
  return {
    id: row.id,
    hsnCode: row.hsnCode,
    description: row.description,
    defaultGstRateBps: row.defaultGstRateBps,
    supplyTaxability: row.supplyTaxability,
    defaultUqcCode: row.defaultUqcCode,
    categoryHint: row.categoryHint,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
