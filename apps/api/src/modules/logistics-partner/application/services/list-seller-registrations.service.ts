import { Inject, Injectable } from '@nestjs/common';
import {
  SELLER_PARTNER_REGISTRATION_REPOSITORY,
  type SellerPartnerRegistrationRepository,
} from '../../infrastructure/repositories/prisma-seller-partner-registration.repository';
import type {
  ListSellerRegistrationsResponse,
  SellerRegistrationItem,
} from '../dto/list-partners-response.dto';

/**
 * Reads every SellerPartnerRegistration row for a seller. The admin UI
 * cross-joins this against the facade's PartnerInfo list to render one
 * row per partner — missing entries become a "PENDING — never tried"
 * status on the frontend.
 */
@Injectable()
export class ListSellerRegistrationsService {
  constructor(
    @Inject(SELLER_PARTNER_REGISTRATION_REPOSITORY)
    private readonly repo: SellerPartnerRegistrationRepository,
  ) {}

  async execute(sellerId: string): Promise<ListSellerRegistrationsResponse> {
    const entities = await this.repo.findBySellerId(sellerId);
    return entities.map(
      (e): SellerRegistrationItem => ({
        partner: e.partner,
        warehouseName: e.warehouseName,
        status: e.status,
        lastError: e.lastError,
        registeredAt: e.registeredAt ? e.registeredAt.toISOString() : null,
        registeredBy: e.registeredBy,
        updatedAt: e.updatedAt.toISOString(),
      }),
    );
  }
}
