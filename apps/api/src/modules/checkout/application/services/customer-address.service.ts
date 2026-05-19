import { Injectable, Inject } from '@nestjs/common';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
  UpdateAddressInput,
} from '../../domain/repositories/checkout.repository.interface';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

// Sprint 3 Story 2.4 — format validation that runs BEFORE we hit the
// pincode database. Reject obvious junk upfront (saves a DB roundtrip
// and gives a more specific error message). The PostOffice lookup
// stays as the authoritative "is this a real pincode" check.
const PIN_FORMAT = /^[1-9][0-9]{5}$/; // 6 digits, leading digit non-zero
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/; // 10 digits, 6/7/8/9 prefix
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;
const ADDRESS_LINE_MAX = 200;

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
    const digitsOnly = input.phone.replace(/[\s-]/g, '');
    if (!INDIAN_MOBILE.test(digitsOnly)) {
      throw new BadRequestAppException(
        'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9',
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
  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
    private readonly prisma: PrismaService,
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
      city: string;
      state: string;
      // Phase 34 — caller-supplied CBIC 2-digit GST code (storefront
      // address-form dropdown). Optional; repository resolves by name
      // when omitted. Validated to 2 digits to fail loudly on garbage.
      stateCode?: string;
      postalCode: string;
      isDefault?: boolean;
    },
  ) {
    const { fullName, phone, addressLine1, postalCode } = input;

    if (!fullName || !phone || !addressLine1 || !postalCode) {
      throw new BadRequestAppException(
        'fullName, phone, addressLine1, and postalCode are required',
      );
    }

    // Sprint 3 Story 2.4 — format validation before DB lookup so junk
    // (non-numeric pincode, invalid phone) fails fast with a specific
    // error rather than getting a generic "pincode not found".
    validateContactFields(input);

    // Phase 34 — if stateCode came from the form dropdown, sanity-check
    // the shape. Repo will re-resolve from name when null, so an
    // invalid code triggers a hard error rather than a silent
    // fallback.
    if (input.stateCode != null && !/^[0-9]{2}$/.test(input.stateCode)) {
      throw new BadRequestAppException(
        'stateCode must be the 2-digit CBIC GST state code',
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

    if (!postOffice) {
      throw new BadRequestAppException(
        `Invalid pincode: ${postalCode} — not found in our database. Please check and try again.`,
      );
    }

    // Use provided city/state if given, otherwise derive from PostOffice
    const resolvedCity = input.city || postOffice.district || '';
    const resolvedState = input.state || postOffice.state || '';
    const resolvedLocality = input.locality || postOffice.officeName || null;

    if (!resolvedCity || !resolvedState) {
      throw new BadRequestAppException(
        'city and state are required (could not auto-detect from pincode)',
      );
    }

    // If setting as default, unset other defaults
    if (input.isDefault) {
      await this.repo.clearDefaultAddresses(customerId);
    }

    const address = await this.repo.createAddress({
      customerId,
      fullName,
      phone,
      addressLine1,
      addressLine2: input.addressLine2 || null,
      locality: resolvedLocality,
      city: resolvedCity,
      state: resolvedState,
      stateCode: input.stateCode ?? null,
      postalCode,
      isDefault: input.isDefault || false,
    });

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

    // Sprint 3 Story 2.4 — same format validation as create. Only
    // checks fields that are actually being updated.
    validateContactFields(input);

    // Phase 34 — same stateCode shape guard as createAddress.
    if (input.stateCode != null && !/^[0-9]{2}$/.test(input.stateCode)) {
      throw new BadRequestAppException(
        'stateCode must be the 2-digit CBIC GST state code',
      );
    }

    // Validate pincode if it's being changed
    if (input.postalCode && input.postalCode !== existing.postalCode) {
      const postOffice = await this.prisma.postOffice.findFirst({
        where: { pincode: input.postalCode },
        select: { pincode: true, district: true, state: true, officeName: true },
      });
      if (!postOffice) {
        throw new BadRequestAppException(
          `Invalid pincode: ${input.postalCode} — not found in our database`,
        );
      }
      // Auto-populate city/state if not explicitly provided in the update
      if (!input.city) input.city = postOffice.district || undefined;
      if (!input.state) input.state = postOffice.state || undefined;
      if (!input.locality) input.locality = postOffice.officeName || undefined;
    }

    // If switching this address to default, clear other defaults first
    if (input.isDefault === true && !existing.isDefault) {
      await this.repo.clearDefaultAddresses(customerId);
    }

    return this.repo.updateAddress(addressId, input);
  }

  async deleteAddress(customerId: string, addressId: string) {
    const existing = await this.repo.findAddressByIdAndCustomer(
      addressId,
      customerId,
    );
    if (!existing) {
      throw new NotFoundAppException('Address not found');
    }
    await this.repo.deleteAddress(addressId);
    return { deleted: true };
  }

  async setDefaultAddress(customerId: string, addressId: string) {
    const existing = await this.repo.findAddressByIdAndCustomer(
      addressId,
      customerId,
    );
    if (!existing) {
      throw new NotFoundAppException('Address not found');
    }
    return this.repo.setDefaultAddress(addressId, customerId);
  }
}
