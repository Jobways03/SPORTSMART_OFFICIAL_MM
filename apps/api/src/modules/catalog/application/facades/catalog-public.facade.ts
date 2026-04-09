import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../domain/repositories/variant.repository.interface';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../domain/repositories/storefront.repository.interface';
import {
  SellerAllocationService,
  AllocationResult,
  StockReservationResult,
} from '../services/seller-allocation.service';

export { AllocationResult, StockReservationResult, AllocatedSeller } from '../services/seller-allocation.service';

@Injectable()
export class CatalogPublicFacade {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    private readonly allocationService: SellerAllocationService,
  ) {}

  async getProductById(productId: string): Promise<unknown> {
    return this.productRepo.findByIdBasic(productId);
  }

  async getVariantById(variantId: string): Promise<unknown> {
    return this.variantRepo.findByIdWithProduct(variantId);
  }

  async getListingModerationStatus(productId: string): Promise<unknown> {
    const product = await this.productRepo.findByIdBasic(productId);
    return product ? product.moderationStatus : null;
  }

  async validateSellerOwnsListing(
    sellerId: string,
    productId: string,
  ): Promise<boolean> {
    const product = await this.productRepo.findByIdAndSeller(productId, sellerId);
    return !!product;
  }

  async getProductSnapshotForOrder(variantId: string): Promise<unknown> {
    return this.variantRepo.findVariantSnapshotForOrder(variantId);
  }

  async getReturnRelevantMetadata(productId: string): Promise<unknown> {
    return this.productRepo.findByIdWithFullDetails(productId);
  }

  // ── Seller Allocation (public API for Checkout/Orders modules) ──────

  async allocate(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    excludeMappingIds?: string[];
  }): Promise<AllocationResult> {
    return this.allocationService.allocate(input);
  }

  async reserveStock(input: {
    mappingId: string;
    quantity: number;
    orderId?: string;
    expiresInMinutes?: number;
  }): Promise<StockReservationResult> {
    return this.allocationService.reserveStock(input);
  }

  async releaseReservation(reservationId: string): Promise<void> {
    return this.allocationService.releaseReservation(reservationId);
  }

  async confirmReservation(reservationId: string, orderId?: string): Promise<void> {
    return this.allocationService.confirmReservation(reservationId, orderId);
  }

  async reallocate(input: {
    orderId: string;
    failedMappingId: string;
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
  }): Promise<AllocationResult> {
    return this.allocationService.reallocate(input);
  }
}
