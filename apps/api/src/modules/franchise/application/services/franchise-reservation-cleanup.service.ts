import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { FranchiseInventoryService } from './franchise-inventory.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

const LOCK_KEY = 'lock:franchise-reservation-cleanup';
const LOCK_TTL_SECONDS = 60;

@Injectable()
export class FranchiseReservationCleanupService implements OnModuleInit, OnModuleDestroy {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  // Kept in sync with the seller-side TTL
  // (seller-allocation.service.ts:reserveStock default `expiresInMinutes = 15`)
  // so a customer sees the same checkout hold regardless of which node the
  // cart was routed to. If you tune one, tune the other.
  private readonly RESERVATION_TTL_MINUTES = 15;
  private lastContractCheck = 0;
  private readonly CONTRACT_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('FranchiseReservationCleanupService');
  }

  onModuleInit() {
    this.cleanupInterval = setInterval(() => this.tick(), 60_000);
    this.logger.log('Franchise reservation cleanup started (every 60s)');
  }

  /**
   * Gate the sweep behind a Redis lock so only one API instance runs
   * the cleanup per tick. Without this, every running instance picks up
   * the same expired ORDER_RESERVE rows and each calls `unreserveStock`
   * — double-releasing held franchise inventory.
   */
  private async tick(): Promise<void> {
    const acquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
    if (!acquired) return;
    try {
      await this.cleanup();
      if (Date.now() - this.lastContractCheck > this.CONTRACT_CHECK_INTERVAL) {
        await this.checkExpiredContracts();
        this.lastContractCheck = Date.now();
      }
    } catch (err) {
      this.logger.error(
        `Franchise cleanup tick failed: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  onModuleDestroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - this.RESERVATION_TTL_MINUTES * 60 * 1000);

    // Find ORDER_RESERVE entries older than TTL that may not have been released
    const expiredReservations = await this.prisma.franchiseInventoryLedger.findMany({
      where: {
        movementType: 'ORDER_RESERVE',
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        franchiseId: true,
        productId: true,
        variantId: true,
        globalSku: true,
        quantityDelta: true,
        referenceId: true,
      },
    });

    let releasedCount = 0;
    for (const reservation of expiredReservations) {
      // Check if this reservation was already released or confirmed
      const followUp = await this.prisma.franchiseInventoryLedger.findFirst({
        where: {
          franchiseId: reservation.franchiseId,
          productId: reservation.productId,
          variantId: reservation.variantId,
          movementType: { in: ['ORDER_UNRESERVE', 'ORDER_SHIP', 'ORDER_CANCEL'] },
          referenceId: reservation.referenceId,
        },
      });

      if (!followUp) {
        // No follow-up found -- reservation is stale, release it
        try {
          await this.inventoryService.unreserveStock(
            reservation.franchiseId,
            reservation.productId,
            reservation.variantId,
            Math.abs(reservation.quantityDelta),
            reservation.referenceId || undefined,
          );
          releasedCount++;
        } catch (err) {
          this.logger.warn(`Failed to release stale reservation: ${(err as Error).message}`);
        }
      }
    }

    if (releasedCount > 0) {
      this.logger.log(`Released ${releasedCount} expired franchise stock reservation(s)`);
    }
    return releasedCount;
  }

  // ── Auto-suspend franchises with expired contracts ──────────────────

  private async checkExpiredContracts() {
    const expired = await this.prisma.franchisePartner.findMany({
      where: {
        status: 'ACTIVE',
        contractEndDate: { lt: new Date() },
        isDeleted: false,
      },
      select: { id: true, franchiseCode: true },
    });

    for (const franchise of expired) {
      await this.prisma.franchisePartner.update({
        where: { id: franchise.id },
        data: { status: 'SUSPENDED' },
      });
      this.logger.warn(
        `Franchise ${franchise.franchiseCode} auto-suspended — contract expired`,
      );
    }
  }
}
