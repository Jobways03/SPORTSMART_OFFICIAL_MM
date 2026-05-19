// Phase 37 — PlatformGstProfileService.
//
// CRUD for Sportsmart's own GSTINs — used as the supplier identity
// for OWN_BRAND / SPORTSMART supplies (no marketplace seller in the
// loop). Typically one row marked isDefault=true; additional rows
// when Sportsmart registers in more states.

import { Injectable } from '@nestjs/common';
import type { GstRegistrationType } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { validateGstin } from '../../domain/gstin-validator';

export interface PlatformGstProfileItem {
  id: string;
  legalBusinessName: string;
  gstin: string;
  registeredAddressJson: unknown;
  gstStateCode: string;
  registrationType: GstRegistrationType;
  panNumber: string | null;
  panLast4: string | null;
  panVerified: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformProfileInput {
  legalBusinessName: string;
  gstin: string;
  registeredAddressJson: unknown;
  registrationType?: GstRegistrationType;
  panNumber?: string | null;
  isDefault?: boolean;
}

export interface UpdatePlatformProfileInput {
  legalBusinessName?: string;
  registeredAddressJson?: unknown;
  registrationType?: GstRegistrationType;
  panNumber?: string | null;
  isActive?: boolean;
}

@Injectable()
export class PlatformGstProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PlatformGstProfileItem[]> {
    const rows = await this.prisma.platformGstProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { gstStateCode: 'asc' }],
    });
    return rows.map(toItem);
  }

  async create(input: CreatePlatformProfileInput): Promise<PlatformGstProfileItem> {
    const validation = validateGstin(input.gstin);
    if (!validation.isValid || !validation.stateCode) {
      throw new BadRequestAppException(
        `Invalid GSTIN: ${validation.errors.join('; ')}`,
      );
    }
    const stateCode: string = validation.stateCode;
    if (!input.legalBusinessName.trim()) {
      throw new BadRequestAppException('legalBusinessName is required');
    }
    if (input.panNumber && input.panNumber.length !== 10) {
      throw new BadRequestAppException('PAN must be 10 characters');
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.platformGstProfile.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      const row = await tx.platformGstProfile.create({
        data: {
          legalBusinessName: input.legalBusinessName.trim(),
          gstin: input.gstin.toUpperCase(),
          gstStateCode: stateCode,
          registeredAddressJson: (input.registeredAddressJson ?? {}) as any,
          registrationType: input.registrationType ?? 'REGULAR',
          panNumber: input.panNumber ?? null,
          panLast4: input.panNumber ? input.panNumber.slice(-4) : null,
          isDefault: input.isDefault ?? false,
          isActive: true,
        },
      });
      return toItem(row);
    });
  }

  async update(
    id: string,
    input: UpdatePlatformProfileInput,
  ): Promise<PlatformGstProfileItem> {
    const existing = await this.prisma.platformGstProfile.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundAppException('Platform GST profile not found');
    const data: Record<string, unknown> = {};
    if (input.legalBusinessName !== undefined)
      data.legalBusinessName = input.legalBusinessName;
    if (input.registeredAddressJson !== undefined)
      data.registeredAddressJson = input.registeredAddressJson;
    if (input.registrationType !== undefined)
      data.registrationType = input.registrationType;
    if (input.panNumber !== undefined) {
      data.panNumber = input.panNumber;
      data.panLast4 = input.panNumber ? input.panNumber.slice(-4) : null;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const updated = await this.prisma.platformGstProfile.update({
      where: { id },
      data,
    });
    return toItem(updated);
  }

  async setDefault(id: string): Promise<PlatformGstProfileItem> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.platformGstProfile.findUnique({ where: { id } });
      if (!target) throw new NotFoundAppException('Platform GST profile not found');
      if (!target.isActive) {
        throw new BadRequestAppException(
          'Cannot mark an inactive profile as default. Reactivate it first.',
        );
      }
      await tx.platformGstProfile.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      const row = await tx.platformGstProfile.update({
        where: { id },
        data: { isDefault: true },
      });
      return toItem(row);
    });
  }
}

function toItem(row: {
  id: string;
  legalBusinessName: string;
  gstin: string;
  registeredAddressJson: unknown;
  gstStateCode: string;
  registrationType: GstRegistrationType;
  panNumber: string | null;
  panLast4: string | null;
  panVerified: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PlatformGstProfileItem {
  return {
    id: row.id,
    legalBusinessName: row.legalBusinessName,
    gstin: row.gstin,
    registeredAddressJson: row.registeredAddressJson,
    gstStateCode: row.gstStateCode,
    registrationType: row.registrationType,
    panNumber: row.panNumber,
    panLast4: row.panLast4,
    panVerified: row.panVerified,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
