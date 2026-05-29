// Phase 37 — UqcMasterService.
//
// CRUD for the CBIC UQC (Unit Quantity Code) list. Every tax invoice
// line declares a UQC per Section 31 / Rule 46; this lets admin add a
// new code without a DB migration. Soft-delete only via isActive — we
// never hard-delete because historical line-snapshots reference the
// short code by value.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

export interface UqcMasterListItem {
  id: string;
  code: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const UQC_CODE_RE = /^[A-Z0-9]{2,8}$/;

@Injectable()
export class UqcMasterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: { search?: string; activeOnly?: boolean }): Promise<UqcMasterListItem[]> {
    const where: Record<string, unknown> = {};
    if (filter.activeOnly) where.isActive = true;
    if (filter.search) {
      where.OR = [
        { code: { contains: filter.search.toUpperCase() } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.uqcMaster.findMany({
      where,
      orderBy: { code: 'asc' },
      take: 500,
    });
    return rows.map(toListItem);
  }

  async create(input: {
    code: string;
    description: string;
  }): Promise<UqcMasterListItem> {
    const code = input.code.toUpperCase().trim();
    if (!UQC_CODE_RE.test(code)) {
      throw new BadRequestAppException(
        'UQC code must be 2-8 alphanumeric characters (e.g. NOS, PCS, KGS)',
      );
    }
    if (!input.description.trim()) {
      throw new BadRequestAppException('description is required');
    }
    const row = await this.prisma.uqcMaster.create({
      data: {
        code,
        description: input.description.trim(),
      },
    });
    return toListItem(row);
  }

  async update(
    id: string,
    input: { description?: string; isActive?: boolean },
  ): Promise<UqcMasterListItem> {
    const existing = await this.prisma.uqcMaster.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('UQC row not found');
    const data: Record<string, unknown> = {};
    if (input.description !== undefined) data.description = input.description;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const updated = await this.prisma.uqcMaster.update({
      where: { id },
      data,
    });
    return toListItem(updated);
  }
}

function toListItem(row: {
  id: string;
  code: string;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): UqcMasterListItem {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
