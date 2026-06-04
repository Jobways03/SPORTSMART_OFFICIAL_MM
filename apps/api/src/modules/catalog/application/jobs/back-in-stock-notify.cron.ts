import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';

/**
 * Phase 193 (#15) — back-in-stock notifier.
 *
 * Customers who hit a sold-out PDP register interest (BackInStockRequest).
 * This hourly, leader-elected job re-checks stock for products with open
 * requests and emails each once (notifiedAt set), giving the out-of-stock
 * visitor a real conversion path. Bounded batch per tick.
 */
@Injectable()
export class BackInStockNotifyCron {
  private static readonly BATCH = 200;
  private readonly logger = new Logger(BackInStockNotifyCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly notifications: NotificationsPublicFacade,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    await this.leader.run('back-in-stock-notify', 60 * 60, async () => {
      try {
        await this.instr.wrap('back-in-stock-notify', () => this.notifyRestocked());
      } catch (err) {
        this.logger.error(`back-in-stock notify failed: ${(err as Error).message}`);
      }
    });
  }

  private async notifyRestocked(): Promise<{ notified: number }> {
    const open = await this.prisma.backInStockRequest.findMany({
      where: { notifiedAt: null },
      take: BackInStockNotifyCron.BATCH,
      include: { product: { select: { id: true, slug: true, title: true, status: true, isDeleted: true, moderationStatus: true } } },
    });
    if (open.length === 0) return { notified: 0 };

    // Resolve which of the affected products are now in stock (one query).
    const productIds = [...new Set(open.map((r) => r.productId))];
    const inStockRows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id FROM products p
      WHERE p.id IN (${Prisma.join(productIds)})
        AND p.is_deleted = false AND p.status = 'ACTIVE' AND p.moderation_status = 'APPROVED'
        AND EXISTS (
          SELECT 1 FROM seller_product_mappings spm
          WHERE spm.product_id = p.id AND spm.is_active = true
            AND spm.approval_status = 'APPROVED' AND (spm.stock_qty - spm.reserved_qty) > 0
        )
    `);
    const inStock = new Set(inStockRows.map((r) => r.id));

    let notified = 0;
    for (const req of open) {
      if (!inStock.has(req.productId)) continue;
      const p = req.product;
      try {
        await this.notifications.notify({
          channel: 'EMAIL',
          to: req.email,
          subject: `Back in stock: ${p.title}`,
          body:
            `<p>Good news — <strong>${p.title}</strong> is back in stock on SPORTSMART.</p>` +
            `<p><a href="/products/${p.slug}">View the product →</a></p>`,
          eventType: 'catalog.back_in_stock',
          triggerSource: 'CRON:back-in-stock',
        });
        await this.prisma.backInStockRequest.update({ where: { id: req.id }, data: { notifiedAt: new Date() } });
        notified++;
      } catch (err) {
        this.logger.warn(`Failed to notify ${req.email} for ${req.productId}: ${(err as Error).message}`);
      }
    }
    if (notified > 0) this.logger.log(`back-in-stock: notified ${notified} request(s)`);
    return { notified };
  }
}
