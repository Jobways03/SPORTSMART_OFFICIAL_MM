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
}
