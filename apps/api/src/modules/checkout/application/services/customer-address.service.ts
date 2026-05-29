import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
  UpdateAddressInput,
} from '../../domain/repositories/checkout.repository.interface';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

// Sprint 3 Story 2.4 — format validation that runs BEFORE we hit the
// pincode database. Reject obvious junk upfront (saves a DB roundtrip
// and gives a more specific error message). The PostOffice lookup
// stays as the authoritative "is this a real pincode" check.
const PIN_FORMAT = /^[1-9][0-9]{5}$/; // 6 digits, leading digit non-zero
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/; // 10 digits, 6/7/8/9 prefix
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;
const ADDRESS_LINE_MAX = 200;

// Phase 63 (2026-05-22) — per-customer address cap (audit Gap #12).
// Pre-Phase-63 there was no cap; a hostile authed user could fill
// customer_addresses with thousands of rows and degrade the list
// query. 50 is generous for a real customer.
const MAX_ADDRESSES_PER_CUSTOMER = 50;

/**
 * Phase 63 (2026-05-22) — normalize a phone number for storage.
 * The DTO @Transform handles the storefront's +91-prefixed shape
 * before validation; this is the service-level back-compat path
 * for any caller that bypasses the pipe (legacy tests, internal
 * jobs). Mirrors the DTO logic so the two stay aligned.
 */
function normalizePhone(value: string): string {
  const digitsOnly = (value ?? '').replace(/[^\d]/g, '');
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly.slice(2);
  }
  return digitsOnly;
}

function validateContactFields(input: {
  fullName?: string | null;
  phone?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
}) {
  if (input.fullName != null) {
    const trimmed = input.fullName.trim();
    if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
      throw new BadRequestAppException(
        `fullName must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters`,
      );
    }
  }
  if (input.phone != null) {
    // Phase 63 (audit Gap #8) — normalize before regex so storefront-
    // sent `+91XXXXXXXXXX` doesn't 400 customer first saves.
    const normalized = normalizePhone(input.phone);
    if (!INDIAN_MOBILE.test(normalized)) {
      throw new BadRequestAppException(
        'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9 (with or without +91 prefix)',
      );
    }
  }
  if (input.postalCode != null && !PIN_FORMAT.test(input.postalCode)) {
    throw new BadRequestAppException(
      'postalCode must be a 6-digit Indian PIN (first digit non-zero)',
    );
  }
  if (input.addressLine1 != null && input.addressLine1.length > ADDRESS_LINE_MAX) {
    throw new BadRequestAppException(
      `addressLine1 must be ${ADDRESS_LINE_MAX} characters or fewer`,
    );
  }
  if (input.addressLine2 != null && input.addressLine2.length > ADDRESS_LINE_MAX) {
    throw new BadRequestAppException(
      `addressLine2 must be ${ADDRESS_LINE_MAX} characters or fewer`,
    );
  }
}

@Injectable()
export class CustomerAddressService {
  private readonly logger = new Logger(CustomerAddressService.name);

  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
    private readonly prisma: PrismaService,
    // Phase 63 (2026-05-22) — audit log on every address mutation
    // (audit Gap #14). AuditModule is @Global() so no module wiring.
    private readonly audit: AuditPublicFacade,
  ) {}

  async listAddresses(customerId: string) {
    const addresses = await this.repo.findAddressesByCustomer(customerId);
    return addresses;
  }

  async createAddress(
    customerId: string,
    input: {
      fullName: string;
      phone: string;
      addressLine1: string;
      addressLine2?: string;
      locality?: string;
      landmark?: string;
      city: string;
      state: string;
      stateCode?: string;
      postalCode: string;
      isDefault?: boolean;
      addressType?: 'HOME' | 'WORK' | 'OTHER';
    },
  ) {
    const { fullName, phone, addressLine1, postalCode } = input;

    if (!fullName || !phone || !addressLine1 || !postalCode) {
      throw new BadRequestAppException(
        'fullName, phone, addressLine1, and postalCode are required',
      );
    }

    validateContactFields(input);
    // Persist canonical 10-digit phone regardless of how the caller
    // shaped it. The DTO @Transform already does this; the service-
    // side normalize keeps the back-compat path safe.
    const canonicalPhone = normalizePhone(phone);

    // Phase 34 — if stateCode came from the form dropdown, sanity-check
    // the shape.
    if (input.stateCode != null && !/^[0-9]{2}$/.test(input.stateCode)) {
      throw new BadRequestAppException(
        'stateCode must be the 2-digit CBIC GST state code',
      );
    }

    // Phase 63 (audit Gap #12) — per-customer cap. Counted before
    // the cap is hit so two parallel adds at limit-1 don't both
    // succeed (the DB partial unique index protects the default
    // invariant; for the line cap a tx-internal check is overkill).
    const live = await this.repo.countLiveAddressesForCustomer(customerId);
    if (live >= MAX_ADDRESSES_PER_CUSTOMER) {
      throw new BadRequestAppException(
        `Address book limit reached (${MAX_ADDRESSES_PER_CUSTOMER}). Remove an address to add a new one.`,
      );
    }

    // Validate pincode against PostOffice database and auto-populate
    // city / state / locality when available.
    const postOffice = await this.prisma.postOffice.findFirst({
      where: { pincode: postalCode },
      select: {
        pincode: true,
        officeName: true,
        district: true,
        state: true,
      },
    });

    // Phase 63 (audit Gap #9) — PostOffice miss is no longer a hard
    // reject when the customer has supplied a city + state. India
    // has ~155k pincodes and the seed lags new postal-circle
    // openings; refusing the save entirely was leaving customers
    // stranded. Log warn so ops can spot growing miss-rates.
    if (!postOffice && (!input.city || !input.state)) {
      throw new BadRequestAppException(
        `Invalid pincode: ${postalCode} — not found in our database. Please check, or provide city and state explicitly.`,
      );
    }
    if (!postOffice) {
      this.logger.warn(
        `PostOffice miss for pincode ${postalCode} — accepting with caller-supplied city/state for customer ${customerId}`,
      );
    }

    // Use provided city/state if given, otherwise derive from PostOffice
    const resolvedCity = input.city || postOffice?.district || '';
    const resolvedState = input.state || postOffice?.state || '';
    const resolvedLocality = input.locality || postOffice?.officeName || null;

    if (!resolvedCity || !resolvedState) {
      throw new BadRequestAppException(
        'city and state are required (could not auto-detect from pincode)',
      );
    }

    // Phase 63 (audit Gap #18) — when the customer typed a state
    // name and didn't supply an explicit stateCode, verify that
    // we can resolve a CBIC code from it. A regional spelling
    // ("Bombay" / "Bangalore") that doesn't match india_states
    // would otherwise persist as stateCode=null and the tax engine
    // would fall back to the legacy state-code-map drift surface.
    // Skip the gate when the dropdown supplied stateCode directly.
    if (input.stateCode == null) {
      const probe = await (this.prisma as any).indiaState.findFirst({
        where: {
          stateName: { equals: resolvedState.trim(), mode: 'insensitive' },
          isActive: true,
        },
        select: { gstStateCode: true },
      });
      if (!probe) {
        throw new BadRequestAppException(
          `State "${resolvedState}" is not in the GST state list. Please select from the dropdown.`,
        );
      }
    }

    // Phase 63 (audit Gap #1) — atomic clear+create. The repo wraps
    // both writes in a single $transaction and the partial unique
    // index in the same migration is the DB-level backstop.
    const address = await this.repo.createAddressAtomic({
      customerId,
      fullName,
      phone: canonicalPhone,
      addressLine1,
      addressLine2: input.addressLine2 || null,
      locality: resolvedLocality,
      landmark: input.landmark || null,
      city: resolvedCity,
      state: resolvedState,
      stateCode: input.stateCode ?? null,
      postalCode,
      isDefault: input.isDefault || false,
      addressType: input.addressType ?? null,
    });

    // Phase 63 (audit Gap #14) — audit log entry for every mutation.
    await this.audit
      .writeAuditLog({
        actorId: customerId,
        actorRole: 'CUSTOMER',
        action: 'CUSTOMER_ADDRESS_CREATED',
        module: 'checkout',
        resource: 'CustomerAddress',
        resourceId: address.id,
        oldValue: null,
        newValue: {
          isDefault: address.isDefault,
          state: address.state,
          postalCode: address.postalCode,
        },
        metadata: { customerId, addressType: address.addressType },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write failed for CUSTOMER_ADDRESS_CREATED ${address.id}: ${(err as Error).message}`,
        ),
      );

    return address;
  }

  async updateAddress(
    customerId: string,
    addressId: string,
    input: UpdateAddressInput,
  ) {
    const existing = await this.repo.findAddressByIdAndCustomer(
      addressId,
      customerId,
    );
    if (!existing) {
      throw new NotFoundAppException('Address not found');
    }

    validateContactFields(input);
    if (input.phone != null) {
      input.phone = normalizePhone(input.phone);
    }

    if (input.stateCode != null && !/^[0-9]{2}$/.test(input.stateCode)) {
      throw new BadRequestAppException(
        'stateCode must be the 2-digit CBIC GST state code',
      );
    }

    if (input.postalCode && input.postalCode !== existing.postalCode) {
      const postOffice = await this.prisma.postOffice.findFirst({
        where: { pincode: input.postalCode },
        select: { pincode: true, district: true, state: true, officeName: true },
      });
      if (!postOffice && (!input.city || !input.state)) {
        throw new BadRequestAppException(
          `Invalid pincode: ${input.postalCode} — not found. Please check, or provide city and state explicitly.`,
        );
      }
      if (!postOffice) {
        this.logger.warn(
          `PostOffice miss for pincode ${input.postalCode} on update — accepting with caller-supplied city/state for customer ${customerId}`,
        );
      } else {
        if (!input.city) input.city = postOffice.district || undefined;
        if (!input.state) input.state = postOffice.state || undefined;
        if (!input.locality) input.locality = postOffice.officeName || undefined;
      }
    }

    // Phase 63 (audit Gap #1) — atomic clear+update.
    const updated = await this.repo.updateAddressAtomic(addressId, customerId, input);

    // Phase 63 (audit Gap #14) — audit log.
    await this.audit
      .writeAuditLog({
        actorId: customerId,
        actorRole: 'CUSTOMER',
        action: 'CUSTOMER_ADDRESS_UPDATED',
        module: 'checkout',
        resource: 'CustomerAddress',
        resourceId: addressId,
        oldValue: {
          isDefault: existing.isDefault,
          state: existing.state,
          postalCode: existing.postalCode,
        },
        newValue: {
          isDefault: updated.isDefault,
          state: updated.state,
          postalCode: updated.postalCode,
        },
        metadata: { customerId, changedFields: Object.keys(input) },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write failed for CUSTOMER_ADDRESS_UPDATED ${addressId}: ${(err as Error).message}`,
        ),
      );

    return updated;
  }

  async deleteAddress(customerId: string, addressId: string) {
    const existing = await this.repo.findAddressByIdAndCustomer(
      addressId,
      customerId,
    );
    if (!existing) {
      throw new NotFoundAppException('Address not found');
    }

    // Phase 63 (audit Gaps #2 + #3) — soft delete + promote successor
    // if the deleted row was the default. Single transaction so the
    // customer is never left in the zero-defaults state.
    const { promoted } = await this.repo.softDeleteAddressWithDefaultPromotion(
      addressId,
      customerId,
    );

    await this.audit
      .writeAuditLog({
        actorId: customerId,
        actorRole: 'CUSTOMER',
        action: 'CUSTOMER_ADDRESS_DELETED',
        module: 'checkout',
        resource: 'CustomerAddress',
        resourceId: addressId,
        oldValue: { isDefault: existing.isDefault, state: existing.state },
        newValue: { deletedAt: new Date().toISOString() },
        metadata: {
          customerId,
          promotedSuccessorId: promoted?.id ?? null,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write failed for CUSTOMER_ADDRESS_DELETED ${addressId}: ${(err as Error).message}`,
        ),
      );

    return {
      deleted: true,
      promotedDefaultId: promoted?.id ?? null,
    };
  }

  async setDefaultAddress(customerId: string, addressId: string) {
    const existing = await this.repo.findAddressByIdAndCustomer(
      addressId,
      customerId,
    );
    if (!existing) {
      throw new NotFoundAppException('Address not found');
    }
    let result: { previous: any; current: any };
    try {
      result = await this.repo.setDefaultAddress(addressId, customerId);
    } catch (err: any) {
      // Phase 63 (audit Gap #1 backstop) — the partial unique index
      // raises P2002 if another writer somehow lands two defaults
      // for the same customer. Surface as a 409 instead of leaking
      // the Prisma error code.
      if (err?.code === 'P2002') {
        throw new ConflictAppException(
          'Another default-address change is in progress. Please retry.',
        );
      }
      throw err;
    }

    await this.audit
      .writeAuditLog({
        actorId: customerId,
        actorRole: 'CUSTOMER',
        action: 'CUSTOMER_ADDRESS_SET_DEFAULT',
        module: 'checkout',
        resource: 'CustomerAddress',
        resourceId: addressId,
        oldValue: result.previous
          ? { defaultAddressId: result.previous.id }
          : { defaultAddressId: null },
        newValue: { defaultAddressId: addressId },
        metadata: { customerId },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write failed for CUSTOMER_ADDRESS_SET_DEFAULT ${addressId}: ${(err as Error).message}`,
        ),
      );

    return result;
  }
}
