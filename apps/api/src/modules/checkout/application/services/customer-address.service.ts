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
