import { Injectable, Inject } from '@nestjs/common';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
} from '../../domain/repositories/checkout.repository.interface';
import { BadRequestAppException } from '../../../../core/exceptions';

@Injectable()
export class CustomerAddressService {
  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
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
    const { fullName, phone, addressLine1, city, state, postalCode } = input;

    if (!fullName || !phone || !addressLine1 || !city || !state || !postalCode) {
      throw new BadRequestAppException(
        'fullName, phone, addressLine1, city, state, and postalCode are required',
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
      locality: input.locality || null,
      city,
      state,
      postalCode,
      isDefault: input.isDefault || false,
    });

    return address;
  }
}
