import { Injectable } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { sanitizeRichText } from '../../../../core/utils/rich-text-sanitizer';

/**
 * #249.7 (stored-XSS) — `description` is rich HTML (the AI generator emits
 * markup, and sellers can paste it) that is later rendered raw on the
 * storefront product page. Both the seller and admin create/update paths
 * funnel through this repository's createInTransaction / updateInTransaction,
 * so sanitising the `description` here (rather than in each controller) covers
 * every write path with a single choke point. Only a non-empty string is
 * sanitised; `undefined` is left untouched so a partial update that does not
 * touch `description` never blanks the stored value.
 */
function sanitizeProductDescription<T extends { description?: unknown }>(
  data: T,
): T {
  if (typeof data.description === 'string' && data.description.length > 0) {
    return { ...data, description: sanitizeRichText(data.description) };
  }
  return data;
}

/**
 * Phase 31 (2026-05-21) — shared moderation-review state set the three
 * status-flip transactions accept. Mirrors
 * AdminProductsController.MODERATION_REVIEW_STATES; kept here as
 * ProductStatus[] so the Prisma updateMany WHERE compiles cleanly.
 */
const MODERATION_REVIEW_STATES: ProductStatus[] = [
  ProductStatus.SUBMITTED,
  ProductStatus.DRAFT,
  ProductStatus.REJECTED,
  ProductStatus.CHANGES_REQUESTED,
];
import {
  IProductRepository,
  ProductListParams,
  ProductListResult,
  SellerProductListParams,
} from '../../domain/repositories/product.repository.interface';

@Injectable()
export class PrismaProductRepository implements IProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(params: ProductListParams): Promise<ProductListResult> {
    const { page, limit, search, status, moderationStatus, categoryId, sellerId, hasSellers, allowedSellerTypes } = params;

    const where: any = { isDeleted: false };
    if (status) {
      where.status = status;
    } else {
      // Hide never-submitted drafts from the default admin view. A product the
      // seller created but hasn't yet submitted for review is DRAFT +
      // moderationStatus PENDING and isn't the admin's concern until it enters
      // the review pipeline. Submitting flips status to SUBMITTED (moderation
      // stays PENDING), so submitted items still show; a DRAFT sent back from
      // REJECTED/CHANGES_REQUESTED keeps its non-PENDING moderationStatus and
      // also still shows. An explicit ?status=DRAFT overrides this so admins can
      // still find/audit drafts when they choose to.
      where.NOT = [{ status: 'DRAFT', moderationStatus: 'PENDING' }];
    }
    if (moderationStatus) where.moderationStatus = moderationStatus;
    if (categoryId) where.categoryId = categoryId;
    if (sellerId) where.sellerId = sellerId;
    // Seller-type scope (2026-06-24): strict channel isolation. A D2C/RETAIL-
    // scoped admin sees ONLY products OWNED by a seller of their own channel. A
    // product owned by another channel's seller — even one a D2C seller merely
    // offers (maps) — no longer appears in this catalog list. Cross-channel
    // OFFERS are still surfaced for review/approval by the dedicated
    // "Pending Seller Approvals" view (/admin/seller-mappings/pending), which
    // scopes by seller type on its own — so dropping the offer branch here hides
    // no approval work; it just keeps each channel's product catalog its own.
    if (allowedSellerTypes && allowedSellerTypes.length > 0) {
      where.AND = [
        ...(where.AND || []),
        { seller: { sellerType: { in: allowedSellerTypes } } },
      ];
    }
    if (hasSellers) {
      where.OR = [
        ...(where.OR || []),
        { sellerId: { not: null } },
        { sellerMappings: { some: {} } },
      ];
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { baseSku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          // sellerType lets the seller-admin UI hide master-product actions
          // (edit/approve/delete) for products owned by a different seller type
          // — those actions are owner-gated on the backend and would 404.
          seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true, sellerType: true } },
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: { where: { isDeleted: false }, select: { stock: true } },
          sellerMappings: {
            // Seller-type scope: only count/show mappings owned by sellers of
            // the admin's type, so the per-product seller summary + count match
            // the scoped view (a D2C admin shouldn't see retail offers here).
            // No approvalStatus/isActive filter — the controller needs PENDING +
            // STOPPED rows for low-stock + distinct-seller counts; it filters to
            // APPROVED+isActive for the headline totals.
            where:
              allowedSellerTypes && allowedSellerTypes.length > 0
                ? { seller: { sellerType: { in: allowedSellerTypes } } }
                : undefined,
            select: {
              sellerId: true,
              approvalStatus: true,
              isActive: true,
              stockQty: true,
              reservedQty: true,
            },
          },
          _count: { select: { variants: true } },
          // Phase 32 (2026-05-21) — pull just enough status history to
          // derive `isReSubmission` for the admin moderation queue.
          // A SUBMITTED product whose history contains any prior
          // APPROVED entry is a re-submission (seller edited a
          // previously-live product) — moderators want to prioritise
          // those because the seller is already vetted.
          statusHistory: {
            where: { toStatus: 'APPROVED' },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    // Phase 32 — fold the derived field. We strip the history rows
    // before returning so consumers don't accidentally rely on the
    // peek; the boolean is the contract.
    const enriched = products.map((p) => {
      const history = (p as { statusHistory?: Array<{ id: string }> }).statusHistory ?? [];
      const isReSubmission = history.length > 0;
      const { statusHistory: _strip, ...rest } = p as Record<string, unknown>;
      return { ...rest, isReSubmission };
    });

    return { products: enriched, total };
  }

  async findByIdWithFullDetails(productId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
        variants: {
          where: { isDeleted: false },
          include: {
            optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
            images: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        options: { include: { optionDefinition: true }, orderBy: { sortOrder: 'asc' } },
        optionValues: { include: { optionValue: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        tags: true,
        seo: true,
        category: true,
        brand: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async findByIdBasic(productId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });
  }

  async findBySellerPaginated(params: SellerProductListParams): Promise<ProductListResult> {
    const { sellerId, page, limit, status, search, categoryId } = params;

    const where: any = { sellerId, isDeleted: false };
    if (status) where.status = status;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { baseSku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: { where: { isDeleted: false }, select: { stock: true } },
          _count: { select: { variants: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total };
  }

  async findByIdForSeller(productId: string, sellerId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, sellerId, isDeleted: false },
      include: {
        variants: {
          where: { isDeleted: false },
          include: {
            optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
            images: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        options: { include: { optionDefinition: true }, orderBy: { sortOrder: 'asc' } },
        optionValues: { include: { optionValue: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        tags: true,
        seo: true,
        category: true,
        brand: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
        // Phase 39 — the seller edit form hydrates its Category-fields
        // section from these rows (keyed by metafieldDefinitionId).
        // Without this include the form silently rendered every
        // metafield as empty even though values were persisted.
        metafields: { include: { metafieldDefinition: true } },
      },
    });
  }

  async createInTransaction(
    data: any,
    tags?: string[],
    seo?: any,
    variants?: any[],
    statusHistoryEntry?: any,
  ): Promise<any> {
    try {
      return await this.createInTransactionUnsafe(data, tags, seo, variants, statusHistoryEntry);
    } catch (err: any) {
      // Map a unique-constraint violation (slug-collision race, or a duplicate
      // variant SKU) to a clean 409 instead of leaking a Prisma 500.
      if (err?.code === 'P2002') {
        throw new ConflictAppException(
          'A product with these details already exists (duplicate slug or SKU). Please retry.',
        );
      }
      throw err;
    }
  }

  private async createInTransactionUnsafe(
    data: any,
    tags?: string[],
    seo?: any,
    variants?: any[],
    statusHistoryEntry?: any,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // #249.7 — sanitise rich-text `description` before persisting (covers
      // both the seller and admin create paths, which both land here).
      const newProduct = await tx.product.create({
        data: sanitizeProductDescription(data),
      });

      if (tags && tags.length > 0) {
        await tx.productTag.createMany({
          data: tags.map((tag) => ({ productId: newProduct.id, tag })),
        });
      }

      if (seo) {
        await tx.productSeo.create({
          data: { productId: newProduct.id, metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, handle: seo.handle },
        });
      }

      if (variants && variants.length > 0) {
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          const variant = await tx.productVariant.create({
            data: {
              productId: newProduct.id,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              costPrice: v.costPrice,
              sku: v.sku,
              stock: v.stock ?? 0,
              weight: v.weight,
              sortOrder: i,
            },
          });
          if (v.optionValueIds && v.optionValueIds.length > 0) {
            await tx.productVariantOptionValue.createMany({
              data: v.optionValueIds.map((ovId: string) => ({ variantId: variant.id, optionValueId: ovId })),
            });
          }
        }
      }

      if (statusHistoryEntry) {
        await tx.productStatusHistory.create({
          data: { productId: newProduct.id, ...statusHistoryEntry },
        });
      }

      return newProduct;
    });
  }

  async updateInTransaction(productId: string, updateData: any, tags?: string[], seo?: any): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // #249.7 — sanitise rich-text `description` before persisting (covers
      // both the seller and admin update paths, which both land here). A
      // partial update with no `description` key is left untouched.
      const updated = await tx.product.update({
        where: { id: productId },
        data: sanitizeProductDescription(updateData),
      });

      if (tags !== undefined) {
        await tx.productTag.deleteMany({ where: { productId } });
        if (tags.length > 0) {
          await tx.productTag.createMany({ data: tags.map((tag) => ({ productId, tag })) });
        }
      }

      if (seo !== undefined) {
        await tx.productSeo.upsert({
          where: { productId },
          create: { productId, metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, handle: seo.handle },
          update: { metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, handle: seo.handle },
        });
      }

      return updated;
    });
  }

  async softDelete(productId: string): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  // Phase 256 — clear moderation to APPROVED for an already-live product whose
  // moderationStatus is still PENDING (an inconsistent state, e.g. seeded
  // straight to ACTIVE). Stamps the moderation-audit columns the same way a
  // normal approval does. No lifecycle transition (the row is already ACTIVE).
  async approveModerationOnly(
    productId: string,
    moderatorId: string,
  ): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        moderationStatus: 'APPROVED',
        moderatorId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
    });
  }

  async softDeleteWithVariants(productId: string): Promise<string[]> {
    // Returns the ids of the variants that were soft-deleted as part
    // of the cascade, so the caller can emit downstream events
    // (catalog.variant.soft_deleted) per variant. Querying inside the
    // same transaction before the updateMany keeps the list honest
    // under concurrent writes.
    return this.prisma.$transaction(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { productId, isDeleted: false },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);

      await tx.productVariant.updateMany({
        where: { productId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      await tx.product.update({
        where: { id: productId },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      return variantIds;
    });
  }

  async findFullProduct(productId: string): Promise<any | null> {
    // Soft-deleted products must not surface in fetched-by-id reads — all
    // other product reads in this repo already filter `isDeleted: false`
    // and this was the only one that didn't, so callers could receive a
    // tombstoned record if an id leaked through a URL or stale cache.
    return this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        tags: true,
        seo: true,
        variants: { where: { isDeleted: false } },
        category: true,
        brand: true,
        images: { orderBy: { sortOrder: 'asc' } },
        seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
        sellerMappings: true,
      },
    });
  }

  async updateStatusInTransaction(productId: string, statusData: any, historyEntry: any): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: statusData });
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async approveInTransaction(
    productId: string,
    historyEntries: any[],
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    // Phase 31 (2026-05-21) — race-safe CAS. Pre-Phase-31 two admins
    // approving the same SUBMITTED row both succeeded: each ran
    // findUnique→update without checking the status hadn't drifted
    // between read and write. Both moderatorId / reviewedAt writes
    // landed (last write wins), both `catalog.listing.approved`
    // events fired, and downstream got two seller-notification
    // emails for one decision. The fix is a status-conditional
    // updateMany inside the tx — if a concurrent caller has already
    // flipped the row to ACTIVE / APPROVED, count=0 and we throw a
    // conflict that the controller can surface as 409.
    const eligible = MODERATION_REVIEW_STATES;
    await this.prisma.$transaction(async (tx) => {
      // Phase 29 (2026-05-21) — publish-readiness check (extracted to
      // assertPublishReadyTx so the re-activation path enforces the same gate).
      await this.assertPublishReadyTx(tx, productId);

      // Phase 31 — race-safe status-conditional update. updateMany so
      // the WHERE predicate is part of the same SQL UPDATE the DB
      // serialises. If count=0 a concurrent admin already flipped the
      // row out of the eligible set; rollback the whole tx with a
      // 409 the controller can surface.
      const res = await tx.product.updateMany({
        where: { id: productId, status: { in: eligible } },
        data: {
          status: 'ACTIVE',
          moderationStatus: 'APPROVED',
          moderationNote: null,
          rejectionReason: null,
          changeRequestNote: null,
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      if (res.count !== 1) {
        throw new ConflictAppException(
          'Product was modified concurrently — refresh and retry.',
        );
      }

      // 2026-06-02 — activate the product's variants on publish. Variants
      // are created DRAFT (ProductVariant.status @default(DRAFT)) and were
      // never flipped to ACTIVE at approval, so an ACTIVE/APPROVED product
      // was left with DRAFT variants. The cart's validateVariant only
      // accepts ACTIVE/OUT_OF_STOCK, so every such product failed add-to-cart
      // with "Variant not found or not available". Flip DRAFT → ACTIVE in the
      // same tx (DISABLED/ARCHIVED/OUT_OF_STOCK left untouched).
      await tx.productVariant.updateMany({
        where: { productId, isDeleted: false, status: 'DRAFT' },
        data: { status: 'ACTIVE' },
      });

      for (const entry of historyEntries) {
        await tx.productStatusHistory.create({ data: { productId, ...entry } });
      }
    });
  }

  /**
   * Catalog-only approval (2026-06-13). Flips a review-state product
   * (SUBMITTED/DRAFT/REJECTED/CHANGES_REQUESTED) → status='APPROVED',
   * moderationStatus='APPROVED' — catalog content is signed off but the product
   * is NOT live yet. Deliberately does NOT run assertPublishReadyTx (the tax /
   * HSN gate) and does NOT activate variants: making it live is a separate
   * SUPER_ADMIN step (reactivateInTransaction) that runs the full publish gate
   * after the tax/finance team sets the HSN + tax config. Same race-safe CAS as
   * approveInTransaction so two concurrent approvals can't both land.
   */
  async catalogApproveInTransaction(
    productId: string,
    historyEntries: any[],
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    const eligible = MODERATION_REVIEW_STATES;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.product.updateMany({
        where: { id: productId, status: { in: eligible } },
        data: {
          status: 'APPROVED',
          moderationStatus: 'APPROVED',
          moderationNote: null,
          rejectionReason: null,
          changeRequestNote: null,
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      if (res.count !== 1) {
        throw new ConflictAppException(
          'Product was modified concurrently — refresh and retry.',
        );
      }
      for (const entry of historyEntries) {
        await tx.productStatusHistory.create({ data: { productId, ...entry } });
      }
    });
  }

  /**
   * Publish-readiness gate (extracted from approveInTransaction, Phase 29).
   * Throws BadRequestAppException with the missing-field list if the product
   * is not safe to make live: requires categoryId, brandId, basePrice, ≥1
   * image, taxConfigVerified (for TAXABLE), and all required category
   * metafields (with parent-chain inheritance). Runs inside the caller's tx so
   * the check stays atomic with the status flip. Used by BOTH first-approval
   * (approveInTransaction) and re-activation (reactivateInTransaction) so a
   * product that drifted out of readiness (e.g. a bulk tax-config reset that
   * cleared taxConfigVerified) cannot be silently re-published.
   */
  private async assertPublishReadyTx(tx: any, productId: string): Promise<void> {
    const readiness = await tx.product.findUnique({
      where: { id: productId },
      select: {
        categoryId: true,
        brandId: true,
        basePrice: true,
        taxConfigVerified: true,
        supplyTaxability: true,
        _count: { select: { images: true } },
      },
    });
    if (!readiness) {
      throw new NotFoundAppException('Product not found');
    }

    const missing: string[] = [];
    if (!readiness.categoryId) missing.push('categoryId');
    if (!readiness.brandId) missing.push('brandId');
    if (readiness.basePrice == null) missing.push('basePrice');
    if (readiness._count.images < 1) missing.push('at least one image');
    if (
      readiness.supplyTaxability === 'TAXABLE' &&
      !readiness.taxConfigVerified
    ) {
      missing.push('taxConfigVerified');
    }

    if (readiness.categoryId) {
      // Walk the parent chain so a category inheriting required metafields
      // from its root still enforces them at publish time.
      const categoryIds: string[] = [];
      let cursor: string | null = readiness.categoryId;
      let safety = 0;
      while (cursor && safety < 10) {
        categoryIds.push(cursor);
        const cat: { parentId: string | null } | null =
          await tx.category.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
        cursor = cat?.parentId ?? null;
        safety += 1;
      }

      const requiredDefs = await tx.metafieldDefinition.findMany({
        where: { categoryId: { in: categoryIds }, isRequired: true },
        select: { id: true, name: true },
      });
      if (requiredDefs.length > 0) {
        const presentMetafields = await tx.productMetafield.findMany({
          where: {
            productId,
            metafieldDefinitionId: { in: requiredDefs.map((d: any) => d.id) },
          },
          select: { metafieldDefinitionId: true },
        });
        const presentIds = new Set(
          presentMetafields.map((m: any) => m.metafieldDefinitionId),
        );
        for (const def of requiredDefs) {
          if (!presentIds.has(def.id)) {
            missing.push(`metafield: ${def.name}`);
          }
        }
      }
    }

    if (missing.length > 0) {
      throw new BadRequestAppException(
        `Cannot publish — missing: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Re-activate a previously-approved product (SUSPENDED / ARCHIVED / APPROVED
   * → ACTIVE) via the admin status endpoint. Unlike the bare status write this
   * re-runs the full publish-readiness + attestation gate and re-activates
   * DRAFT variants — so a product whose data or tax attestation drifted since
   * its original approval cannot return to a purchasable state without passing
   * the gate again. The CAS predicate also requires moderationStatus=APPROVED,
   * so a never-approved product can never reach ACTIVE through this path
   * (first publish must go through approveInTransaction).
   */
  async reactivateInTransaction(
    productId: string,
    historyEntries: any[],
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.assertPublishReadyTx(tx, productId);

      const res = await tx.product.updateMany({
        where: {
          id: productId,
          status: { in: ['SUSPENDED', 'ARCHIVED', 'APPROVED'] },
          moderationStatus: 'APPROVED',
        },
        data: {
          status: 'ACTIVE',
          moderationStatus: 'APPROVED',
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      if (res.count !== 1) {
        throw new ConflictAppException(
          'Product was modified concurrently or is not eligible for re-activation — refresh and retry.',
        );
      }

      await tx.productVariant.updateMany({
        where: { productId, isDeleted: false, status: 'DRAFT' },
        data: { status: 'ACTIVE' },
      });

      for (const entry of historyEntries) {
        await tx.productStatusHistory.create({ data: { productId, ...entry } });
      }
    });
  }

  async rejectInTransaction(
    productId: string,
    reason: string,
    historyEntry: any,
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    // Phase 31 (2026-05-21) — race-safe CAS. See approveInTransaction
    // for the rationale. /reject and /request-changes accept the same
    // moderation-review state set as /approve (narrowed post-Phase-31).
    const eligible = MODERATION_REVIEW_STATES;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.product.updateMany({
        where: { id: productId, status: { in: eligible } },
        data: {
          status: 'REJECTED',
          moderationStatus: 'REJECTED',
          moderationNote: reason,
          rejectionReason: reason,
          changeRequestNote: null,
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      if (res.count !== 1) {
        throw new ConflictAppException(
          'Product was modified concurrently — refresh and retry.',
        );
      }
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async requestChangesInTransaction(
    productId: string,
    note: string,
    historyEntry: any,
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    const eligible = MODERATION_REVIEW_STATES;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.product.updateMany({
        where: { id: productId, status: { in: eligible } },
        data: {
          status: 'CHANGES_REQUESTED',
          moderationStatus: 'CHANGES_REQUESTED',
          moderationNote: note,
          changeRequestNote: note,
          rejectionReason: null,
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      if (res.count !== 1) {
        throw new ConflictAppException(
          'Product was modified concurrently — refresh and retry.',
        );
      }
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async submitForReviewInTransaction(productId: string, data: any, historyEntry: any): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data });
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
  }

  async findByIdAndSeller(productId: string, sellerId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, sellerId, isDeleted: false },
      select: { id: true },
    });
  }

  async generateNextProductCode(): Promise<string> {
    const sequence = await this.prisma.$transaction(async (tx) => {
      return tx.productCodeSequence.upsert({
        where: { id: 1 },
        create: { id: 1, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
    });
    return `PRD-${String(sequence.lastNumber).padStart(6, '0')}`;
  }

  async findSellerByEmail(email: string): Promise<any | null> {
    return this.prisma.seller.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
  }

  async findSellerById(sellerId: string): Promise<any | null> {
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, status: true, isEmailVerified: true, storeAddress: true, sellerZipCode: true },
    });
  }

  // Phase 33 (2026-05-21) — `findOrCreateCategory` + `findOrCreateBrand`
  // removed. Phase 29 + Phase 30 had already eliminated the last
  // callers (admin + seller product controllers); the methods sat as
  // a backdoor that could only be reached via direct repo injection.
  // New code must reference categoryId / brandId UUIDs — taxonomy is
  // owned by AdminCategoriesController / AdminBrandsController, which
  // are gated by `catalog.write`.
}
