import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Normalise the optional pincode-list patch into a Prisma JSON write.
 *
 *   undefined → skip the field (don't change it)
 *   null      → clear the field (Prisma.JsonNull, NOT DbNull because
 *               the column itself stays nullable)
 *   string[]  → write the array
 *
 * Return type is the Prisma JSON-update union so callers spread it
 * directly into `data:` without further narrowing.
 */
function pincodesPatchValue(
  value: string[] | null | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

/**
 * Admin-side delivery-method entitlements. Toggles per-seller /
 * per-franchise self-delivery enablement + the optional pincode
 * service-area whitelist. The flag gates what method the
 * seller/franchise can pick when fulfilling a SubOrder.
 *
 * (iThink Logistics was removed — self-delivery is the only delivery
 * method today. The courier-agnostic shipping skeleton remains for a
 * future carrier.)
 */
@Injectable()
export class AdminDeliveryMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSellerSettings(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
    if (!seller) throw new NotFoundException(`Seller ${sellerId} not found`);
    return seller;
  }

  async getFranchiseSettings(franchiseId: string) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        businessName: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
    if (!franchise) {
      throw new NotFoundException(`Franchise ${franchiseId} not found`);
    }
    return franchise;
  }

  async updateSellerSettings(
    sellerId: string,
    input: {
      selfDeliveryEnabled?: boolean;
      selfDeliveryPincodes?: string[] | null;
    },
  ) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException(`Seller ${sellerId} not found`);

    return this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        selfDeliveryEnabled: input.selfDeliveryEnabled ?? undefined,
        selfDeliveryPincodes: pincodesPatchValue(input.selfDeliveryPincodes),
      },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
  }

  async updateFranchiseSettings(
    franchiseId: string,
    input: {
      selfDeliveryEnabled?: boolean;
      selfDeliveryPincodes?: string[] | null;
    },
  ) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { id: true },
    });
    if (!franchise) {
      throw new NotFoundException(`Franchise ${franchiseId} not found`);
    }

    return this.prisma.franchisePartner.update({
      where: { id: franchiseId },
      data: {
        selfDeliveryEnabled: input.selfDeliveryEnabled ?? undefined,
        selfDeliveryPincodes: pincodesPatchValue(input.selfDeliveryPincodes),
      },
      select: {
        id: true,
        businessName: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
  }
}
