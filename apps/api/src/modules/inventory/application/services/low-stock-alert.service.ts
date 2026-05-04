import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Detects + records low-stock conditions on seller-product-mappings.
 * Run periodically (Phase F3 cron) or on-demand from admin UI.
 *
 * Alert lifecycle: created when current ≤ threshold; auto-resolved
 * when stock recovers above threshold. Idempotent — re-running won't
 * spam duplicates because of the unique key on sellerProductMappingId.
 */
@Injectable()
export class LowStockAlertService {
  private readonly logger = new Logger(LowStockAlertService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(): Promise<{ created: number; resolved: number }> {
    // Pull mappings whose stock dipped to/below threshold and have no
    // open alert. Default threshold lives on the mapping; fall back to 5.
    const lows = await this.prisma.sellerProductMapping.findMany({
      where: {
        isActive: true,
        // We don't know the threshold value at the SQL filter level; do
        // a coarse fetch then filter in JS.
      },
      select: {
        id: true, sellerId: true, productId: true,
        stockQty: true, lowStockThreshold: true,
      },
      take: 50_000,
    });

    let created = 0;
    let resolved = 0;
    for (const m of lows) {
      const threshold = m.lowStockThreshold ?? 5;
      const isLow = m.stockQty <= threshold;
      const existing = await this.prisma.lowStockAlert.findUnique({
        where: { sellerProductMappingId: m.id },
      });

      if (isLow && !existing) {
        await this.prisma.lowStockAlert.create({
          data: {
            sellerProductMappingId: m.id,
            sellerId: m.sellerId,
            productId: m.productId,
            currentStock: m.stockQty,
            threshold,
          },
        });
        created++;
      } else if (!isLow && existing && !existing.resolvedAt) {
        await this.prisma.lowStockAlert.update({
          where: { id: existing.id },
          data: { resolvedAt: new Date() },
        });
        resolved++;
      }
    }

    this.logger.log(`Low-stock sweep: created=${created} resolved=${resolved}`);
    return { created, resolved };
  }

  async listOpen(args: { sellerId?: string; limit?: number }) {
    return this.prisma.lowStockAlert.findMany({
      where: { resolvedAt: null, ...(args.sellerId ? { sellerId: args.sellerId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(args.limit ?? 200, 500),
    });
  }
}
