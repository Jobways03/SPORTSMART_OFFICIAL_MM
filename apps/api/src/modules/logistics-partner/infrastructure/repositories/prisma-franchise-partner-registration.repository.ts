import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import type { RegistrationStatus } from '../../../../integrations/logistics-facade/logistics-facade.constants';

export const FRANCHISE_PARTNER_REGISTRATION_REPOSITORY = Symbol(
  'FranchisePartnerRegistrationRepository',
);

/** Plain row shape for a franchise's logistics-partner registration. */
export interface FranchiseRegistration {
  id: string;
  franchiseId: string;
  partner: string;
  warehouseName: string | null;
  status: RegistrationStatus;
  lastError: string | null;
  registeredAt: Date | null;
  registeredBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FranchisePartnerRegistrationRepository {
  findByFranchiseId(franchiseId: string): Promise<FranchiseRegistration[]>;
  findByFranchiseIdAndPartner(
    franchiseId: string,
    partner: string,
  ): Promise<FranchiseRegistration | null>;
  upsertPending(
    franchiseId: string,
    partner: string,
    registeredBy?: string,
  ): Promise<FranchiseRegistration>;
  markRegistered(
    id: string,
    warehouseName: string,
    registeredBy?: string,
  ): Promise<FranchiseRegistration>;
  markFailed(id: string, error: string): Promise<FranchiseRegistration>;
  markNotNeeded(id: string): Promise<FranchiseRegistration>;
}

/**
 * Prisma-backed repository for FranchisePartnerRegistration — the
 * franchise analogue of PrismaSellerPartnerRegistrationRepository.
 * Same delegate-cast pattern (see the seller repo header) so it
 * type-checks even before the consuming env regenerates the client.
 */
@Injectable()
export class PrismaFranchisePartnerRegistrationRepository
  implements FranchisePartnerRegistrationRepository
{
  constructor(private readonly prisma: PrismaService) {}

  private get delegate(): {
    findMany: (args: unknown) => Promise<FranchiseRegistration[]>;
    findUnique: (args: unknown) => Promise<FranchiseRegistration | null>;
    upsert: (args: unknown) => Promise<FranchiseRegistration>;
    update: (args: unknown) => Promise<FranchiseRegistration>;
  } {
    return (
      this.prisma as unknown as {
        franchisePartnerRegistration: {
          findMany: (args: unknown) => Promise<FranchiseRegistration[]>;
          findUnique: (args: unknown) => Promise<FranchiseRegistration | null>;
          upsert: (args: unknown) => Promise<FranchiseRegistration>;
          update: (args: unknown) => Promise<FranchiseRegistration>;
        };
      }
    ).franchisePartnerRegistration;
  }

  async findByFranchiseId(
    franchiseId: string,
  ): Promise<FranchiseRegistration[]> {
    return this.delegate.findMany({ where: { franchiseId } });
  }

  async findByFranchiseIdAndPartner(
    franchiseId: string,
    partner: string,
  ): Promise<FranchiseRegistration | null> {
    return this.delegate.findUnique({
      where: { franchiseId_partner: { franchiseId, partner } },
    });
  }

  async upsertPending(
    franchiseId: string,
    partner: string,
    registeredBy?: string,
  ): Promise<FranchiseRegistration> {
    return this.delegate.upsert({
      where: { franchiseId_partner: { franchiseId, partner } },
      create: {
        franchiseId,
        partner,
        status: 'PENDING',
        registeredBy: registeredBy ?? null,
      },
      update: { updatedAt: new Date() },
    });
  }

  async markRegistered(
    id: string,
    warehouseName: string,
    registeredBy?: string,
  ): Promise<FranchiseRegistration> {
    return this.delegate.update({
      where: { id },
      data: {
        warehouseName,
        status: 'REGISTERED',
        lastError: null,
        registeredAt: new Date(),
        ...(registeredBy ? { registeredBy } : {}),
      },
    });
  }

  async markFailed(id: string, error: string): Promise<FranchiseRegistration> {
    return this.delegate.update({
      where: { id },
      data: { status: 'FAILED', lastError: error.slice(0, 2000) },
    });
  }

  async markNotNeeded(id: string): Promise<FranchiseRegistration> {
    return this.delegate.update({
      where: { id },
      data: { status: 'NOT_NEEDED', lastError: null },
    });
  }
}
