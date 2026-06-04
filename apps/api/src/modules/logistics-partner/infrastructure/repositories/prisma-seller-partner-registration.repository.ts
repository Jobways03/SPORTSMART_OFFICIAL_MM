import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { SellerPartnerRegistrationEntity } from '../../domain/seller-partner-registration.entity';
import type { RegistrationStatus } from '../../../../integrations/logistics-facade/logistics-facade.constants';

export const SELLER_PARTNER_REGISTRATION_REPOSITORY = Symbol(
  'SellerPartnerRegistrationRepository',
);

export interface SellerPartnerRegistrationRepository {
  findBySellerId(sellerId: string): Promise<SellerPartnerRegistrationEntity[]>;
  findBySellerIdAndPartner(
    sellerId: string,
    partner: string,
  ): Promise<SellerPartnerRegistrationEntity | null>;
  upsertPending(
    sellerId: string,
    partner: string,
    registeredBy?: string,
  ): Promise<SellerPartnerRegistrationEntity>;
  markRegistered(
    id: string,
    warehouseName: string,
    registeredBy?: string,
  ): Promise<SellerPartnerRegistrationEntity>;
  markFailed(
    id: string,
    error: string,
  ): Promise<SellerPartnerRegistrationEntity>;
  markNotNeeded(id: string): Promise<SellerPartnerRegistrationEntity>;
}

interface RawRow {
  id: string;
  sellerId: string;
  partner: string;
  warehouseName: string | null;
  status: string;
  lastError: string | null;
  registeredAt: Date | null;
  registeredBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Prisma-backed repository for SellerPartnerRegistration.
 *
 * IMPLEMENTATION NOTE — Prisma client typing:
 * The SellerPartnerRegistration delegate is added by the Phase
 * 20260530120000 migration. Until the consuming environment runs
 * `prisma generate` against the new schema, the generated client may
 * not surface the typed delegate. We cast through `unknown` to a
 * narrow shape so the production runtime (which DOES have the
 * regenerated client) works correctly, and tsc still type-checks in
 * environments where the delegate is missing. The cast is the only
 * place this asymmetry lives; the rest of the module talks to the
 * domain entity.
 */
@Injectable()
export class PrismaSellerPartnerRegistrationRepository
  implements SellerPartnerRegistrationRepository
{
  constructor(private readonly prisma: PrismaService) {}

  private get delegate(): {
    findMany: (args: unknown) => Promise<RawRow[]>;
    findUnique: (args: unknown) => Promise<RawRow | null>;
    upsert: (args: unknown) => Promise<RawRow>;
    update: (args: unknown) => Promise<RawRow>;
  } {
    // See header comment. The `as unknown as` chain bypasses the missing
    // generated-client typing without surrendering compile-time safety
    // for the rest of the module.
    return (this.prisma as unknown as {
      sellerPartnerRegistration: {
        findMany: (args: unknown) => Promise<RawRow[]>;
        findUnique: (args: unknown) => Promise<RawRow | null>;
        upsert: (args: unknown) => Promise<RawRow>;
        update: (args: unknown) => Promise<RawRow>;
      };
    }).sellerPartnerRegistration;
  }

  async findBySellerId(
    sellerId: string,
  ): Promise<SellerPartnerRegistrationEntity[]> {
    const rows = await this.delegate.findMany({ where: { sellerId } });
    return rows.map(this.toEntity);
  }

  async findBySellerIdAndPartner(
    sellerId: string,
    partner: string,
  ): Promise<SellerPartnerRegistrationEntity | null> {
    const row = await this.delegate.findUnique({
      where: { sellerId_partner: { sellerId, partner } },
    });
    return row ? this.toEntity(row) : null;
  }

  async upsertPending(
    sellerId: string,
    partner: string,
    registeredBy?: string,
  ): Promise<SellerPartnerRegistrationEntity> {
    const row = await this.delegate.upsert({
      where: { sellerId_partner: { sellerId, partner } },
      create: {
        sellerId,
        partner,
        status: 'PENDING',
        registeredBy: registeredBy ?? null,
      },
      // Don't clobber a successful prior registration — only re-pend
      // when the row was failed / never succeeded.
      update: {
        // No-op fields; presence of the row is what we care about.
        updatedAt: new Date(),
      },
    });
    return this.toEntity(row);
  }

  async markRegistered(
    id: string,
    warehouseName: string,
    registeredBy?: string,
  ): Promise<SellerPartnerRegistrationEntity> {
    const row = await this.delegate.update({
      where: { id },
      data: {
        warehouseName,
        status: 'REGISTERED',
        lastError: null,
        registeredAt: new Date(),
        ...(registeredBy ? { registeredBy } : {}),
      },
    });
    return this.toEntity(row);
  }

  async markFailed(
    id: string,
    error: string,
  ): Promise<SellerPartnerRegistrationEntity> {
    const row = await this.delegate.update({
      where: { id },
      data: {
        status: 'FAILED',
        lastError: error.slice(0, 2000),
      },
    });
    return this.toEntity(row);
  }

  async markNotNeeded(
    id: string,
  ): Promise<SellerPartnerRegistrationEntity> {
    const row = await this.delegate.update({
      where: { id },
      data: {
        status: 'NOT_NEEDED',
        lastError: null,
      },
    });
    return this.toEntity(row);
  }

  private toEntity = (row: RawRow): SellerPartnerRegistrationEntity =>
    new SellerPartnerRegistrationEntity(
      row.id,
      row.sellerId,
      row.partner,
      row.warehouseName,
      row.status as RegistrationStatus,
      row.lastError,
      row.registeredAt,
      row.registeredBy,
      row.createdAt,
      row.updatedAt,
    );
}
