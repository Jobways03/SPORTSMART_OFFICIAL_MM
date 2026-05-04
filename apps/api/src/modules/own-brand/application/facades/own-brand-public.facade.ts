import { Inject, Injectable } from '@nestjs/common';
import {
  OwnBrandRepository,
  OWN_BRAND_REPOSITORY,
} from '../../domain/repositories/own-brand.repository.interface';

/**
 * Cross-module entry point for NOVA own-brand state. Used by the
 * routing engine (Phase 21) to decide if NOVA can fulfil an order
 * for a given pincode, and by the storefront PDP to surface "Sold by
 * NOVA" badges.
 */
@Injectable()
export class OwnBrandPublicFacade {
  constructor(
    @Inject(OWN_BRAND_REPOSITORY) private readonly repo: OwnBrandRepository,
  ) {}

  /** Total available units (stock − reserved) across all active NOVA warehouses. */
  getAvailableForProduct(productId: string, variantId?: string | null) {
    return this.repo.getAvailableForProduct(productId, variantId);
  }

  /** Per-warehouse stock snapshot — the routing engine picks the closest
   *  warehouse to the destination pincode at allocation time. */
  findWarehousesWithStock(productId: string, variantId?: string | null) {
    return this.repo.findWarehousesWithStock(productId, variantId);
  }

  findWarehouseById(id: string) {
    return this.repo.findWarehouseById(id);
  }
}
