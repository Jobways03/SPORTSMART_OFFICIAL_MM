import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

/**
 * Shared service that triggers re-approval when a seller modifies
 * an already-approved/active product.
 *
 * --- Re-approval rule ---
 * Edits to a LIVE product are split into two classes:
 *
 *   • **Price / inventory / physical / policy** — do NOT trigger re-approval.
 *     A seller can reprice, restock, update dimensions, or tweak the return
 *     policy in real time. The product stays LIVE and the change is visible
 *     to customers immediately. See `PRICE_INVENTORY_FIELDS` below for the
 *     full whitelist.
 *
 *   • **Content** (title, description, category/brand, tags, images, SEO,
 *     adding or removing variants) — DOES trigger re-approval. Product
 *     moves back to SUBMITTED + PENDING and is hidden from the storefront
 *     until an admin reviews. Anything not in the whitelist is treated as
 *     content.
 *
 * Callers must pass `opts.changedFields` so the classifier can decide. If
 * omitted (legacy callers, variant creation, image operations), the service
 * falls back to the old behaviour: always trigger re-approval for LIVE
 * products. That keeps image / add-variant / delete-variant flows safe.
 */
@Injectable()
export class ReApprovalService {
  /**
   * Fields that a seller can edit in-place on a LIVE product without
   * re-approval. Covers both Product and ProductVariant columns — the set
   * is intentionally conservative. If you add new whitelisted fields,
   * update this set AND keep the seller UI in sync.
   */
  public static readonly PRICE_INVENTORY_FIELDS: ReadonlySet<string> = new Set([
    // Product — pricing
    'basePrice',
    'compareAtPrice',
    'costPrice',
    // Product — inventory
    'baseSku',
    'baseStock',
    'baseBarcode',
    // Product — physical
    'weight',
    'weightUnit',
    'length',
    'width',
    'height',
    'dimensionUnit',
    // Product — post-purchase policy (not customer-facing content)
    'returnPolicy',
    'warrantyInfo',
    // Variant — pricing
    'price',
    // Variant — inventory
    'sku',
    'stock',
    'barcode',
    // Variant — physical
    // (weight / weightUnit / length / width / height / dimensionUnit shared with product)
    // Variant — status (ACTIVE <-> OUT_OF_STOCK etc.) is inventory too
    'status',
  ]);

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ReApprovalService');
  }

  /**
   * If the product is APPROVED or ACTIVE, move it back to SUBMITTED / PENDING.
   * Returns true if re-approval was triggered, false otherwise.
   *
   * @param opts.changedFields  List of Product or Variant fields that were
   *                            updated by this change. When every entry is in
   *                            `PRICE_INVENTORY_FIELDS`, re-approval is skipped.
   *                            Omit for image / variant-create / variant-delete
   *                            flows, which always trigger re-approval.
   * @param opts.reason         Override the default status-history reason.
   */
  async triggerIfNeeded(
    productId: string,
    changedBy: string,
    opts?: { changedFields?: string[]; reason?: string },
  ): Promise<boolean> {
    const product = await this.productRepo.findByIdBasic(productId);

    if (!product) return false;

    const needsReApproval =
      product.status === 'APPROVED' || product.status === 'ACTIVE';

    if (!needsReApproval) return false;

    // Short-circuit when the caller has told us exactly what changed and
    // every single field is on the price/inventory whitelist.
    const changed = opts?.changedFields;
    if (changed && changed.length > 0) {
      const onlyPriceInventory = changed.every((f) =>
        ReApprovalService.PRICE_INVENTORY_FIELDS.has(f),
      );
      if (onlyPriceInventory) {
        this.logger.log(
          `Skipping re-approval for product ${productId} — only price/inventory fields changed: ${changed.join(', ')}`,
        );
        return false;
      }
    }

    await this.productRepo.updateStatusInTransaction(
      productId,
      { status: 'SUBMITTED', moderationStatus: 'PENDING' },
      {
        fromStatus: product.status,
        toStatus: 'SUBMITTED',
        changedBy,
        reason:
          opts?.reason ??
          (changed && changed.length > 0
            ? `Content changed by seller (${changed.join(', ')}) — re-approval required`
            : 'Product modified by seller — re-approval required'),
      },
    );

    this.logger.log(
      `Re-approval triggered for product ${productId} (was ${product.status})`,
    );

    return true;
  }
}
