import { Module, forwardRef } from '@nestjs/common';

// Facade
import { CatalogPublicFacade } from './application/facades/catalog-public.facade';

// Services
import { ProductSlugService } from './application/services/product-slug.service';
import { ProductCodeService } from './application/services/product-code.service';
import { MasterSkuService } from './application/services/master-sku.service';
import { ProductOwnershipService } from './application/services/product-ownership.service';
import { VariantGeneratorService } from './application/services/variant-generator.service';
import { ReApprovalService } from './application/services/re-approval.service';
import { ServiceabilityService } from './application/services/serviceability.service';
import { SellerAllocationService } from './application/services/seller-allocation.service';
import { PostOfficeCacheService } from './application/services/post-office-cache.service';
import { CatalogCacheService } from './application/services/catalog-cache.service';
import { StockSyncService } from './application/services/stock-sync.service';
// Story 3.5 — pricing tier service (display-only at v1).
import { ProductPricingTierService } from './application/services/product-pricing-tier.service';
// Phase 44 (2026-05-21) — resolver that picks best-eligible tier for a line.
import { PricingResolutionService } from './application/services/pricing-resolution.service';
// Phase 45 (2026-05-21) — atomic tax-config attestation w/ audit log.
import { ProductTaxAttestationService } from './application/services/product-tax-attestation.service';
// Phase 39 (2026-05-21) — required-metafield enforcement on submit/approve.
import { MetafieldValidationService } from './application/services/metafield-validation.service';
// Phase 40 (2026-05-21) — runtime filter-value validation against choices[].
import { StorefrontFilterValidatorService } from './application/services/storefront-filter-validator.service';

// Guards
import { SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

// Integration adapters
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { CloudinaryOrphanSweepCron } from './application/jobs/cloudinary-orphan-sweep.cron';

// ── Repository interfaces (Symbols) ─────────────────────────────────────
import { PRODUCT_REPOSITORY } from './domain/repositories/product.repository.interface';
import { VARIANT_REPOSITORY } from './domain/repositories/variant.repository.interface';
import { CATEGORY_REPOSITORY } from './domain/repositories/category.repository.interface';
import { BRAND_REPOSITORY } from './domain/repositories/brand.repository.interface';
import { PRODUCT_IMAGE_REPOSITORY } from './domain/repositories/product-image.repository.interface';
import { SELLER_MAPPING_REPOSITORY } from './domain/repositories/seller-mapping.repository.interface';
import { METAFIELD_REPOSITORY } from './domain/repositories/metafield.repository.interface';
import { COLLECTION_REPOSITORY } from './domain/repositories/collection.repository.interface';
import { STOREFRONT_REPOSITORY } from './domain/repositories/storefront.repository.interface';

// ── Repository implementations ──────────────────────────────────────────
import { PrismaProductRepository } from './infrastructure/repositories/prisma-product.repository';
import { PrismaVariantRepository } from './infrastructure/repositories/prisma-variant.repository';
import { PrismaCategoryRepository } from './infrastructure/repositories/prisma-category.repository';
import { PrismaBrandRepository } from './infrastructure/repositories/prisma-brand.repository';
import { PrismaProductImageRepository } from './infrastructure/repositories/prisma-product-image.repository';
import { PrismaSellerMappingRepository } from './infrastructure/repositories/prisma-seller-mapping.repository';
import { PrismaMetafieldRepository } from './infrastructure/repositories/prisma-metafield.repository';
import { PrismaCollectionRepository } from './infrastructure/repositories/prisma-collection.repository';
import { PrismaStorefrontRepository } from './infrastructure/repositories/prisma-storefront.repository';

// Controllers - Public
import { CatalogReferenceController } from './presentation/controllers/public/catalog-reference.controller';
import { StorefrontProductsController } from './presentation/controllers/public/storefront-products.controller';
import { StorefrontCollectionsController } from './presentation/controllers/public/storefront-collections.controller';
import { StorefrontServiceabilityController } from './presentation/controllers/public/storefront-serviceability.controller';
import { StorefrontAllocationController } from './presentation/controllers/public/storefront-allocation.controller';
import { PincodeLookupController } from './presentation/controllers/public/pincode-lookup.controller';

// Controllers - Admin Collections
import { AdminCollectionsController } from './presentation/controllers/admin/admin-collections.controller';

// Controllers - Seller
import { SellerProductsController } from './presentation/controllers/seller/seller-products.controller';
import { SellerProductVariantsController } from './presentation/controllers/seller/seller-product-variants.controller';
import { SellerProductImagesController } from './presentation/controllers/seller/seller-product-images.controller';
import { SellerVariantImagesController } from './presentation/controllers/seller/seller-variant-images.controller';
import { SellerProductMappingController } from './presentation/controllers/seller/seller-product-mapping.controller';
// Controllers - Admin
import { AdminProductsController } from './presentation/controllers/admin/admin-products.controller';
import { AdminProductVariantsController } from './presentation/controllers/admin/admin-product-variants.controller';
import { AdminProductImagesController } from './presentation/controllers/admin/admin-product-images.controller';
import { AdminVariantImagesController } from './presentation/controllers/admin/admin-variant-images.controller';
import { AdminSellerMappingsController } from './presentation/controllers/admin/admin-seller-mappings.controller';
import { AdminMetafieldDefinitionsController } from './presentation/controllers/admin/admin-metafield-definitions.controller';
import { AdminProductMetafieldsController } from './presentation/controllers/admin/admin-product-metafields.controller';
import { AdminStorefrontFiltersController } from './presentation/controllers/admin/admin-storefront-filters.controller';
import { AdminCategoriesController } from './presentation/controllers/admin/admin-categories.controller';
import { AdminBrandsController } from './presentation/controllers/admin/admin-brands.controller';

// Controllers - Public (Filters)
import { StorefrontFiltersController } from './presentation/controllers/public/storefront-filters.controller';

// Story 3.5 — pricing tier controllers (admin CRUD + public read).
import { AdminProductPricingTiersController } from './presentation/controllers/admin/admin-product-pricing-tiers.controller';
import { StorefrontProductPricingTiersController } from './presentation/controllers/public/storefront-product-pricing-tiers.controller';
// Phase 44 (2026-05-21) — seller-facing CRUD (audit gap #4).
import { SellerProductPricingTiersController } from './presentation/controllers/seller/seller-product-pricing-tiers.controller';

// Controllers - Seller (Service Area)
import { SellerServiceAreaController } from './presentation/controllers/seller/seller-service-area.controller';

// Cross-module imports
import { CartModule } from '../cart/module';
// Phase 51 (2026-05-21) — pulls StockMovementLedgerService into the
// catalog module so seller-driven manual stock updates land in the
// audit ledger (pre-Phase-51 they bypassed the ledger entirely).
import { InventoryModule } from '../inventory/module';
// Phase 57 (2026-05-22) — pulls AuditPublicFacade so admin
// mapping-approval transitions land in the tamper-evident audit
// chain (pre-Phase-57 only logger.log was written, leaving no
// queryable forensic trail of who approved what when).
import { AuditModule } from '../audit/module';

@Module({
  imports: [forwardRef(() => CartModule), InventoryModule, AuditModule],
  controllers: [
    CatalogReferenceController,
    StorefrontProductsController,
    StorefrontCollectionsController,
    StorefrontServiceabilityController,
    StorefrontAllocationController,
    PincodeLookupController,
    AdminCollectionsController,
    SellerProductsController,
    SellerProductVariantsController,
    SellerProductImagesController,
    SellerVariantImagesController,
    SellerProductMappingController,
    AdminProductsController,
    AdminProductVariantsController,
    AdminProductImagesController,
    AdminVariantImagesController,
    AdminSellerMappingsController,
    AdminMetafieldDefinitionsController,
    AdminProductMetafieldsController,
    AdminStorefrontFiltersController,
    AdminCategoriesController,
    AdminBrandsController,
    StorefrontFiltersController,
    SellerServiceAreaController,
    AdminProductPricingTiersController,
    StorefrontProductPricingTiersController,
    SellerProductPricingTiersController,
  ],
  providers: [
    // ── Repository bindings ─────────────────────────────────────────────
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
    { provide: VARIANT_REPOSITORY, useClass: PrismaVariantRepository },
    { provide: CATEGORY_REPOSITORY, useClass: PrismaCategoryRepository },
    { provide: BRAND_REPOSITORY, useClass: PrismaBrandRepository },
    { provide: PRODUCT_IMAGE_REPOSITORY, useClass: PrismaProductImageRepository },
    { provide: SELLER_MAPPING_REPOSITORY, useClass: PrismaSellerMappingRepository },
    { provide: METAFIELD_REPOSITORY, useClass: PrismaMetafieldRepository },
    { provide: COLLECTION_REPOSITORY, useClass: PrismaCollectionRepository },
    { provide: STOREFRONT_REPOSITORY, useClass: PrismaStorefrontRepository },

    // ── Application services ────────────────────────────────────────────
    CatalogPublicFacade,
    ProductSlugService,
    ProductCodeService,
    MasterSkuService,
    ProductOwnershipService,
    VariantGeneratorService,
    ReApprovalService,
    ServiceabilityService,
    // Phase 4 follow-up (2026-05-16) — Redis-backed PostOffice
    // cache. Eliminates 50+ table scans per allocation across the
    // 165K-row post_offices reference dataset.
    PostOfficeCacheService,
    SellerAllocationService,
    CatalogCacheService,
    StockSyncService,
    ProductPricingTierService,
    PricingResolutionService,
    ProductTaxAttestationService,
    MetafieldValidationService,
    StorefrontFilterValidatorService,

    // ── Guards & adapters ───────────────────────────────────────────────
    SellerAuthGuard,
    AdminAuthGuard,
    CloudinaryAdapter,
    // Phase 14 (2026-05-16) — Cloudinary orphan sweep cron. Daily
    // 04:00 UTC; deletes Cloudinary assets whose owning Product has
    // been soft-deleted beyond the retention window.
    CloudinaryOrphanSweepCron,
  ],
  // Phase 59 (2026-05-22) — CatalogCacheService exported so the
  // admin-control-tower bulk suspend/activate path can invalidate
  // the storefront product-list cache without going through an
  // event subscriber indirection (audit Gap #11).
  exports: [CatalogPublicFacade, CatalogCacheService],
})
export class CatalogModule {}
