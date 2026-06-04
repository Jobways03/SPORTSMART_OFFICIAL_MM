import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SELLER_PARTNER_REGISTRATION_REPOSITORY,
  type SellerPartnerRegistrationRepository,
} from '../../infrastructure/repositories/prisma-seller-partner-registration.repository';
import {
  SELLER_REPOSITORY,
  type SellerRepository,
} from '../../../seller/domain/repositories/seller.repository.interface';
import {
  LogisticsFacadePartnersService,
  type FacadeWarehouseAddress,
} from '../../../../integrations/logistics-facade/services/logistics-facade-partners.service';
import { PARTNER_CODES } from '../../../../integrations/logistics-facade/logistics-facade.constants';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import type { RegisterPartnerResponse } from '../dto/register-partner-request.dto';

export interface RegisterSellerWithPartnerInput {
  sellerId: string;
  partnerCode: string;
  /** Admin user id from the request — recorded for audit. */
  triggeredBy?: string;
}

/**
 * Orchestrates the "Add pickup location to {Partner}" admin action:
 *
 *   1. Load the seller. Must exist + be ACTIVE.
 *   2. Upsert a SellerPartnerRegistration row (PENDING).
 *   3. Short-circuit for partners that don't need warehouse
 *      registration (status -> NOT_NEEDED).
 *   4. Build the FacadeWarehouseAddress from the seller record and
 *      call the facade.
 *   5. On success → mark REGISTERED + emit a domain event.
 *   6. On failure → mark FAILED + return error body to controller.
 *
 * Returns the response body the controller hands to the admin UI.
 * Failures from the partner are returned as `ok: false + error` (200 OK)
 * rather than thrown, so the UI can render the message and offer a
 * retry without having to parse a 5xx envelope. Pre-condition failures
 * (seller not found, seller not ACTIVE) ARE thrown — those are caller
 * errors, not partner-side state.
 */
@Injectable()
export class RegisterSellerWithPartnerService {
  private readonly logger = new Logger(RegisterSellerWithPartnerService.name);

  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    @Inject(SELLER_PARTNER_REGISTRATION_REPOSITORY)
    private readonly registrationRepo: SellerPartnerRegistrationRepository,
    private readonly facadePartners: LogisticsFacadePartnersService,
    private readonly eventBus: EventBusService,
  ) {}

  async execute(
    input: RegisterSellerWithPartnerInput,
  ): Promise<RegisterPartnerResponse> {
    const partner = input.partnerCode.toUpperCase();

    // 1. Validate seller.
    const seller = await this.sellerRepo.findById(input.sellerId);
    if (!seller) {
      throw new NotFoundException(`Seller ${input.sellerId} not found`);
    }
    if (seller.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Seller status is ${seller.status}; only ACTIVE sellers can be ` +
          `registered with logistics partners.`,
      );
    }

    // 2. Upsert pending row (idempotent).
    const pending = await this.registrationRepo.upsertPending(
      input.sellerId,
      partner,
      input.triggeredBy,
    );

    // 3. Shadowfax (and any future NOT_NEEDED partner) short-circuits.
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

    // 4. Build the partner-agnostic warehouse address from the seller.
    const address = this.buildAddress(seller, partner);
    if (!address.ok) {
      const failed = await this.registrationRepo.markFailed(
        pending.id,
        address.error,
      );
      return {
        ok: false,
        partner: failed.partner,
        status: failed.status,
        warehouseName: failed.warehouseName,
        registeredAt: null,
        error: address.error,
      };
    }

    // 5. Call the facade.
    const result = await this.facadePartners.registerWarehouse(
      partner,
      address.address,
    );

    if (!result.ok) {
      const failed = await this.registrationRepo.markFailed(
        pending.id,
        result.message,
      );
      this.logger.warn(
        `Partner registration failed for seller=${input.sellerId} partner=${partner}: ${result.message}`,
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

    // 6. Emit domain event so downstream listeners (audit, notifications)
    //    can react. Best-effort; failure to publish does not roll back
    //    the registration (the row itself is the source of truth).
    try {
      await this.eventBus.publish({
        eventName: 'seller.warehouse.registered',
        aggregate: 'Seller',
        aggregateId: input.sellerId,
        occurredAt: new Date(),
        payload: {
          sellerId: input.sellerId,
          partner: success.partner,
          warehouseName: success.warehouseName,
          registrationId: success.id,
          triggeredBy: input.triggeredBy,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to publish SellerWarehouseRegistered for seller=${input.sellerId}: ${
          (err as Error)?.message
        }`,
      );
    }

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
   * Push the seller's CURRENT address to an already-registered partner
   * warehouse (the seller-admin "Update address to Delhivery" action).
   *
   * Sellers can't edit their address themselves once registered; the
   * admin edits the seller profile, then triggers this to sync. Delhivery
   * only allows editing address / pin / phone / registered-name — the
   * facility name and contact person are fixed at create time.
   */
  async updateAddress(
    input: RegisterSellerWithPartnerInput,
  ): Promise<RegisterPartnerResponse> {
    const partner = input.partnerCode.toUpperCase();

    const seller = await this.sellerRepo.findById(input.sellerId);
    if (!seller) {
      throw new NotFoundException(`Seller ${input.sellerId} not found`);
    }

    const existing = await this.registrationRepo.findBySellerIdAndPartner(
      input.sellerId,
      partner,
    );
    if (
      !existing ||
      existing.status !== 'REGISTERED' ||
      !existing.warehouseName
    ) {
      throw new BadRequestException(
        `Seller is not registered with ${partner}; register a pickup ` +
          `location before updating its address.`,
      );
    }

    const built = this.buildAddress(seller, partner);
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
        `Address update failed for seller=${input.sellerId} partner=${partner}: ${result.message}`,
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
   * Build the canonical pickup-location payload from the seller
   * record. Different partners require different mandatory fields; we
   * surface a per-partner validation gate here so the upstream call
   * fails fast with a useful message rather than emitting a 4xx from
   * the partner-side adapter.
   */
  private buildAddress(
    seller: {
      sellerId?: string;
      id: string;
      sellerName: string;
      sellerShopName: string;
      storeAddress: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
      sellerZipCode: string | null;
      sellerContactNumber: string | null;
      sellerContactCountryCode: string | null;
      phoneNumber: string;
      email: string;
    },
    partner: string,
  ):
    | { ok: true; address: FacadeWarehouseAddress }
    | { ok: false; error: string } {
    const phone =
      seller.sellerContactNumber || seller.phoneNumber || '';
    const pin = (seller.sellerZipCode || '').replace(/\s+/g, '');
    const address = seller.storeAddress?.trim();

    const missing: string[] = [];
    if (!pin || !/^[0-9]{6}$/.test(pin)) missing.push('sellerZipCode');
    if (!phone) missing.push('contactNumber');
    if (!address) missing.push('storeAddress');
    if (partner === PARTNER_CODES.DELHIVERY && !address) {
      missing.push('returnAddress');
    }
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Cannot register with ${partner} — seller profile is missing required fields: ${missing.join(
          ', ',
        )}.`,
      };
    }

    // Facility (pickup-location) name = the seller's own shop name —
    // Delhivery echoes it as pickup_location.name on every shipment.
    // NOTE: Delhivery treats `name` as a UNIQUE + IMMUTABLE identifier per
    // client account. Two sellers with the same shop name will collide, and
    // a later shop rename can't be pushed (the warehouse name is fixed at
    // create time). If that becomes a problem, append a per-seller suffix.
    const name = seller.sellerShopName.trim();

    return {
      ok: true,
      address: {
        name,
        // Registered (business) name = the shop name.
        registeredName: seller.sellerShopName,
        // Contact person = the seller's (owner) name — maps to Delhivery's
        // `contact_person` field, shown as "Contact Person Name" in the panel.
        contactPerson: seller.sellerName,
        // Contact number = the seller's own contact number (falls back to
        // the account phone if the dedicated contact field is blank).
        phone,
        email: seller.email,
        address: address!,
        city: seller.city ?? undefined,
        pin,
        country: seller.country ?? 'India',
        returnAddress: address!,
        returnPin: pin,
        returnCity: seller.city ?? undefined,
        returnState: seller.state ?? undefined,
        returnCountry: seller.country ?? 'India',
      },
    };
  }
}
