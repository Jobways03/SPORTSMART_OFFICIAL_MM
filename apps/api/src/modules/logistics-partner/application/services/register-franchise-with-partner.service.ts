import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  FRANCHISE_PARTNER_REGISTRATION_REPOSITORY,
  type FranchisePartnerRegistrationRepository,
} from '../../infrastructure/repositories/prisma-franchise-partner-registration.repository';
import {
  LogisticsFacadePartnersService,
  type FacadeWarehouseAddress,
} from '../../../../integrations/logistics-facade/services/logistics-facade-partners.service';
import { PARTNER_CODES } from '../../../../integrations/logistics-facade/logistics-facade.constants';
import type { RegisterPartnerResponse } from '../dto/register-partner-request.dto';

export interface RegisterFranchiseWithPartnerInput {
  franchiseId: string;
  partnerCode: string;
  /** Admin user id from the request — recorded for audit. */
  triggeredBy?: string;
}

/** The franchise fields the warehouse payload is built from. */
interface FranchiseRecord {
  id: string;
  status: string;
  businessName: string;
  ownerName: string;
  email: string;
  phoneNumber: string;
  address: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  warehouseAddress: string | null;
  warehousePincode: string | null;
}

/**
 * Franchise analogue of RegisterSellerWithPartnerService. A franchise
 * registers its store as a courier pickup location ("warehouse") the
 * same way a seller does — same facade call, same status semantics —
 * but the payload is built from the FranchisePartner record (its
 * dedicated warehouse address fields) and the row lives in
 * FranchisePartnerRegistration (FK to the franchise, not the seller).
 */
@Injectable()
export class RegisterFranchiseWithPartnerService {
  private readonly logger = new Logger(RegisterFranchiseWithPartnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FRANCHISE_PARTNER_REGISTRATION_REPOSITORY)
    private readonly registrationRepo: FranchisePartnerRegistrationRepository,
    private readonly facadePartners: LogisticsFacadePartnersService,
  ) {}

  private async loadFranchise(franchiseId: string): Promise<FranchiseRecord> {
    const franchise = (await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        status: true,
        businessName: true,
        ownerName: true,
        email: true,
        phoneNumber: true,
        address: true,
        locality: true,
        city: true,
        state: true,
        country: true,
        pincode: true,
        warehouseAddress: true,
        warehousePincode: true,
      },
    })) as FranchiseRecord | null;
    if (!franchise) {
      throw new NotFoundException(`Franchise ${franchiseId} not found`);
    }
    if (franchise.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Franchise status is ${franchise.status}; only ACTIVE franchises can ` +
          `be registered with logistics partners.`,
      );
    }
    return franchise;
  }

  async execute(
    input: RegisterFranchiseWithPartnerInput,
  ): Promise<RegisterPartnerResponse> {
    const partner = input.partnerCode.toUpperCase();
    const franchise = await this.loadFranchise(input.franchiseId);

    const pending = await this.registrationRepo.upsertPending(
      input.franchiseId,
      partner,
      input.triggeredBy,
    );

    if (partner === PARTNER_CODES.SHADOWFAX) {
      const updated = await this.registrationRepo.markNotNeeded(pending.id);
      return {
        ok: true,
        partner: updated.partner,
        status: updated.status,
        warehouseName: updated.warehouseName,
        registeredAt: updated.registeredAt
          ? updated.registeredAt.toISOString()
          : null,
      };
    }

    const built = this.buildAddress(franchise, partner);
    if (!built.ok) {
      const failed = await this.registrationRepo.markFailed(
        pending.id,
        built.error,
      );
      return {
        ok: false,
        partner: failed.partner,
        status: failed.status,
        warehouseName: failed.warehouseName,
        registeredAt: null,
        error: built.error,
      };
    }

    const result = await this.facadePartners.registerWarehouse(
      partner,
      built.address,
    );
    if (!result.ok) {
      const failed = await this.registrationRepo.markFailed(
        pending.id,
        result.message,
      );
      this.logger.warn(
        `Franchise partner registration failed for franchise=${input.franchiseId} partner=${partner}: ${result.message}`,
      );
      return {
        ok: false,
        partner: failed.partner,
        status: failed.status,
        warehouseName: failed.warehouseName,
        registeredAt: null,
        error: result.message,
      };
    }

    const success = await this.registrationRepo.markRegistered(
      pending.id,
      result.data.warehouseName,
      input.triggeredBy,
    );
    return {
      ok: true,
      partner: success.partner,
      status: success.status,
      warehouseName: success.warehouseName,
      registeredAt: success.registeredAt
        ? success.registeredAt.toISOString()
        : null,
    };
  }

  /**
   * Push the franchise's CURRENT address to an already-registered
   * partner warehouse (the franchise-admin "Update address" action).
   */
  async updateAddress(
    input: RegisterFranchiseWithPartnerInput,
  ): Promise<RegisterPartnerResponse> {
    const partner = input.partnerCode.toUpperCase();
    const franchise = await this.loadFranchise(input.franchiseId);

    const existing = await this.registrationRepo.findByFranchiseIdAndPartner(
      input.franchiseId,
      partner,
    );
    if (
      !existing ||
      existing.status !== 'REGISTERED' ||
      !existing.warehouseName
    ) {
      throw new BadRequestException(
        `Franchise is not registered with ${partner}; register a pickup ` +
          `location before updating its address.`,
      );
    }

    const built = this.buildAddress(franchise, partner);
    if (!built.ok) {
      return {
        ok: false,
        partner,
        status: existing.status,
        warehouseName: existing.warehouseName,
        registeredAt: existing.registeredAt
          ? existing.registeredAt.toISOString()
          : null,
        error: built.error,
      };
    }

    const result = await this.facadePartners.updateWarehouse(
      partner,
      existing.warehouseName,
      {
        registeredName: built.address.registeredName,
        phone: built.address.phone,
        address: built.address.address,
        pin: built.address.pin,
      },
    );
    if (!result.ok) {
      this.logger.warn(
        `Franchise address update failed for franchise=${input.franchiseId} partner=${partner}: ${result.message}`,
      );
      return {
        ok: false,
        partner,
        status: existing.status,
        warehouseName: existing.warehouseName,
        registeredAt: existing.registeredAt
          ? existing.registeredAt.toISOString()
          : null,
        error: result.message,
      };
    }

    return {
      ok: true,
      partner,
      status: 'REGISTERED',
      warehouseName: existing.warehouseName,
      registeredAt: existing.registeredAt
        ? existing.registeredAt.toISOString()
        : null,
    };
  }

  /**
   * Build the pickup-location payload from the franchise record.
   *   • facility name (`name`)    = businessName
   *   • contact person            = ownerName
   *   • registered name           = businessName
   *   • address / pin             = the dedicated warehouse fields,
   *                                 falling back to the store address.
   */
  private buildAddress(
    franchise: FranchiseRecord,
    partner: string,
  ):
    | { ok: true; address: FacadeWarehouseAddress }
    | { ok: false; error: string } {
    const phone = franchise.phoneNumber || '';
    const pin = (franchise.warehousePincode || franchise.pincode || '').replace(
      /\s+/g,
      '',
    );
    const address = (
      franchise.warehouseAddress ||
      franchise.address ||
      ''
    ).trim();

    const missing: string[] = [];
    if (!pin || !/^[0-9]{6}$/.test(pin)) missing.push('warehousePincode');
    if (!phone) missing.push('phoneNumber');
    if (!address) missing.push('warehouseAddress');
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Cannot register with ${partner} — franchise profile is missing required fields: ${missing.join(
          ', ',
        )}.`,
      };
    }

    return {
      ok: true,
      address: {
        name: franchise.businessName.trim(),
        registeredName: franchise.businessName,
        contactPerson: franchise.ownerName,
        phone,
        email: franchise.email,
        address,
        city: franchise.city ?? undefined,
        pin,
        country: franchise.country ?? 'India',
        returnAddress: address,
        returnPin: pin,
        returnCity: franchise.city ?? undefined,
        returnState: franchise.state ?? undefined,
        returnCountry: franchise.country ?? 'India',
      },
    };
  }
}
