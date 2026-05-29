import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';
import { NotFoundAppException } from '../../../../core/exceptions';

/**
 * Centralises the "is this seller the owner of this product?" check
 * used by four seller-facing controllers:
 *
 *   - SellerProductsController (read/update/delete/submit/self-status)
 *   - SellerProductImagesController
 *   - SellerProductVariantsController
 *   - SellerVariantImagesController
 *
 * The wrapper is a deliberate one-liner today: every callsite needs
 * the same fetch-or-404 idiom at the top of its handler, and inlining
 * it across ~15 callsites duplicated the same 3-line block everywhere.
 *
 * The 404 (rather than 403) is intentional and security-significant:
 * returning 403 for "exists but owned by someone else" leaks the
 * existence of other sellers' products to an enumeration attack.
 * 404 collapses both "doesn't exist" and "not yours" into the same
 * response.
 *
 * Future extensions land here without churning every controller:
 *   - Caching the ownership lookup for the request lifetime.
 *   - Audit logging when an admin impersonates a seller for support
 *     and walks through this surface.
 *   - Cross-actor ownership rules (e.g. franchise principal accessing
 *     seller-scoped routes).
 *
 * Phase 32 (2026-05-21) — audit asked to either inline or document the
 * wrapper. Documenting per the audit's own guidance — inlining trades
 * a single-line indirection for 45+ duplicated lines across 4
 * controllers, with no extension surface for the items above.
 */
@Injectable()
export class ProductOwnershipService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
  ) {}

  async validateOwnership(sellerId: string, productId: string): Promise<void> {
    const product = await this.productRepo.findByIdAndSeller(productId, sellerId);

    if (!product) {
      // See class doc: 404 (not 403) is intentional to prevent
      // existence enumeration of other sellers' products.
      throw new NotFoundAppException('Product not found');
    }
  }
}
