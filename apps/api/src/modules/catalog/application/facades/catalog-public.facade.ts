import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../domain/repositories/variant.repository.interface';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../domain/repositories/storefront.repository.interface';
import {
  SellerAllocationService,
  AllocationResult,
  StockReservationResult,
  AllocateAndReserveResult,
} from '../services/seller-allocation.service';
import {
  PricingResolutionService,
  ResolveArgs,
  ResolveResult,
} from '../services/pricing-resolution.service';

export {
  AllocationResult,
  StockReservationResult,
  AllocatedSeller,
  AllocateAndReserveResult,
} from '../services/seller-allocation.service';
export type { ResolveArgs, ResolveResult } from '../services/pricing-resolution.service';

@Injectable()
export class CatalogPublicFacade {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    private readonly allocationService: SellerAllocationService,
    private readonly pricingResolution: PricingResolutionService,
  ) {}

  /**
   * Phase 44 (2026-05-21) — pricing-tier resolution. Exposed via the
   * public facade so cart / checkout / orders modules can call it
   * without importing catalog internals.
   */
  async resolveUnitPrice(args: ResolveArgs): Promise<ResolveResult> {
    return this.pricingResolution.resolveUnitPrice(args);
  }

  async resolveBatchUnitPrices(
    items: ReadonlyArray<ResolveArgs>,
    at?: Date,
  ): Promise<ResolveResult[]> {
    return this.pricingResolution.resolveBatch(items, at);
  }

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

  /**
   * Get product with variants, images, and category info.
   * Used by franchise/POS/procurement modules that need product details.
   */
  async getProductWithDetails(productId: string): Promise<unknown> {
    return this.productRepo.findByIdWithFullDetails(productId);
  }

  /**
   * Validate a product exists and is active.
   */
  async isProductActive(productId: string): Promise<boolean> {
    const product = await this.productRepo.findByIdBasic(productId);
    return !!product && product.status === 'ACTIVE';
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

  /**
   * Phase 64 (2026-05-22) — non-mutating allocator preview (audit
   * Gaps #3 + #5). Same eligibility rules as `allocate` but skips
   * the AllocationLog write. Used by the cart-level
   * serviceability endpoint so a customer's cart-page polling
   * doesn't pollute the forensic log.
   */
  async previewServiceability(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
  }): Promise<AllocationResult> {
    return this.allocationService.previewServiceability(input);
  }

  async reserveStock(input: {
    mappingId: string;
    quantity: number;
    orderId?: string;
    expiresInMinutes?: number;
    // Phase 52 polish (2026-05-21) — attribution passthrough.
    customerId?: string | null;
    sessionId?: string | null;
    cartId?: string | null;
  }): Promise<StockReservationResult> {
    return this.allocationService.reserveStock(input);
  }

  /**
   * One-shot allocate + reserve with automatic primary→secondary→tertiary
   * fallback if the highest-ranked candidate loses a concurrent reservation
   * race. Preferred over calling `allocate` + `reserveStock` separately —
   * the combined path closes the TOCTOU window between the two calls.
   */
  async allocateAndReserve(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    orderId?: string;
    expiresInMinutes?: number;
    excludeMappingIds?: string[];
    // Phase 77 — attribution passthrough (Phase 52 invariant).
    customerId?: string | null;
    sessionId?: string | null;
    cartId?: string | null;
  }): Promise<AllocateAndReserveResult> {
    return this.allocationService.allocateAndReserve(input);
  }

  async releaseReservation(reservationId: string): Promise<void> {
    return this.allocationService.releaseReservation(reservationId);
  }

  async confirmReservation(reservationId: string, orderId?: string): Promise<void> {
    return this.allocationService.confirmReservation(reservationId, orderId);
  }

  /**
   * Phase 69 (2026-05-22) — Phase 68 audit Gap #8. Idempotent
   * stock-reservation guarantor used by orders.service.verifyOrder.
   * See seller-allocation.service.ts for the contract.
   */
  async ensureConfirmedReservationAtVerify(input: {
    orderId: string;
    mappingId: string;
    quantity: number;
    customerId?: string | null;
  }): Promise<{ reservationId: string; reused: boolean }> {
    return this.allocationService.ensureConfirmedReservationAtVerify(input);
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
