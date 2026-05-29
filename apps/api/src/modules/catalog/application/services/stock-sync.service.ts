import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

type PrismaLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class StockSyncService {
  private readonly logger = new Logger(StockSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalculates ProductVariant.stock as SUM of all SellerProductMapping.stockQty
   * for that variant. Call this after any mapping stock change.
   */
  async syncVariantStockFromMappings(
    productId: string,
    variantId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db: PrismaLike = tx ?? this.prisma;

    if (variantId) {
      const result = await db.sellerProductMapping.aggregate({
        where: { productId, variantId },
        _sum: { stockQty: true },
      });
      const totalStock = result._sum.stockQty ?? 0;

      await db.productVariant.update({
        where: { id: variantId },
        data: { stock: totalStock },
      });

      this.logger.debug(
        `Synced variant ${variantId} stock to ${totalStock} (from mappings)`,
      );
    } else {
      // Simple product (no variant) — sync to Product.baseStock
      const result = await db.sellerProductMapping.aggregate({
        where: { productId, variantId: null },
        _sum: { stockQty: true },
      });
      const totalStock = result._sum.stockQty ?? 0;

      await db.product.update({
        where: { id: productId },
        data: { baseStock: totalStock },
      });

      this.logger.debug(
        `Synced product ${productId} baseStock to ${totalStock} (from mappings)`,
      );
    }
  }

  /**
   * Updates a seller's mapping stockQty when they edit variant stock directly.
   * Sets the mapping stock to the new variant stock value.
   */
  async syncMappingStockFromVariant(
    sellerId: string,
    productId: string,
    variantId: string,
    newStock: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db: PrismaLike = tx ?? this.prisma;

    const mapping = await db.sellerProductMapping.findFirst({
      where: { sellerId, productId, variantId },
    });

    if (mapping) {
      await db.sellerProductMapping.update({
        where: { id: mapping.id },
        data: { stockQty: newStock },
      });

      this.logger.debug(
        `Synced mapping ${mapping.id} stockQty to ${newStock} (from variant update)`,
      );
    }
  }

  /**
   * Phase 41 (2026-05-21) — atomic variant update + mapping sync.
   * Closes audit gap #10 (oversell window when a concurrent checkout
   * reservation interleaved between the variant write and the mapping
   * write).
   *
   * The transaction:
   *   1. SELECT FOR UPDATE on the matching mapping row (Postgres
   *      advisory-lock equivalent for inventory). Any concurrent
   *      reservation that takes the same row blocks until we commit.
   *   2. Update the variant row.
   *   3. If newStock is provided, update the mapping's stockQty to
   *      match.
   *
   * The lock is held only for the duration of the (small) write
   * transaction so reservation latency is bounded.
   */
  async updateVariantWithMappingSync(args: {
    sellerId: string;
    productId: string;
    variantId: string;
    updateData: Record<string, unknown>;
    newStock?: number;
  }): Promise<unknown> {
    const { sellerId, productId, variantId, updateData, newStock } = args;

    return this.prisma.$transaction(async (tx) => {
      // Phase 41 — SELECT ... FOR UPDATE on the mapping row. We always
      // try to lock so the reservation path (which also locks the
      // mapping at checkout) serializes against us, even when this
      // call doesn't touch the stock column. The lock is a no-op when
      // no mapping exists.
      await tx.$queryRaw`
        SELECT id FROM seller_product_mappings
        WHERE seller_id = ${sellerId}
          AND product_id = ${productId}
          AND variant_id = ${variantId}
        FOR UPDATE
      `;

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: updateData,
        include: {
          optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
          images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        },
      });

      if (newStock !== undefined) {
        const mapping = await tx.sellerProductMapping.findFirst({
          where: { sellerId, productId, variantId },
        });
        if (mapping) {
          await tx.sellerProductMapping.update({
            where: { id: mapping.id },
            data: { stockQty: newStock },
          });
        }
      }

      return updated;
    });
  }

  /**
   * Phase 41 (2026-05-21) — admin path. Admin variant updates don't
   * cascade to seller mappings (each seller owns their own stock), but
   * they DO change status / price / dimensions that downstream
   * reservation logic may read. Wrap the variant write in a
   * transaction with SELECT FOR UPDATE on every mapping row for this
   * variant so any concurrent checkout reservation serializes against
   * the admin write. This is defense-in-depth: today no admin path
   * syncs mapping stock, but the lock means a future change can do so
   * without re-introducing the seller-path race window.
   */
  async updateVariantAdmin(
    productId: string,
    variantId: string,
    updateData: Record<string, unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM seller_product_mappings
        WHERE product_id = ${productId}
          AND variant_id = ${variantId}
        FOR UPDATE
      `;
      return tx.productVariant.update({
        where: { id: variantId },
        data: updateData,
        include: {
          optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
          images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        },
      });
    });
  }

  /**
   * Phase 41 — bulk variant edit path. Same lock pattern as
   * updateVariantWithMappingSync but doesn't update the variant row
   * (the bulk-update path already updated it transactionally via
   * bulkUpdate). Used to serialize the per-row mapping sync after
   * bulkUpdate without re-doing the variant write.
   */
  async syncMappingStockFromVariantLocked(
    sellerId: string,
    productId: string,
    variantId: string,
    newStock: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM seller_product_mappings
        WHERE seller_id = ${sellerId}
          AND product_id = ${productId}
          AND variant_id = ${variantId}
        FOR UPDATE
      `;
      const mapping = await tx.sellerProductMapping.findFirst({
        where: { sellerId, productId, variantId },
      });
      if (mapping) {
        await tx.sellerProductMapping.update({
          where: { id: mapping.id },
          data: { stockQty: newStock },
        });
      }
    });
  }
}
