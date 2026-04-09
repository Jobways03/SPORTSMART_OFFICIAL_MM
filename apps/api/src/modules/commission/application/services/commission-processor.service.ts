import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import {
  CommissionRepository,
  COMMISSION_REPOSITORY,
  CreateCommissionRecordData,
  CommissionRecordFilter,
  CommissionSettingsData,
} from '../../domain/repositories/commission.repository.interface';

const LOCK_KEY = 'lock:commission-processor';
const LOCK_TTL = 30; // 30 seconds lock

@Injectable()
export class CommissionProcessorService implements OnModuleInit {
  private readonly logger = new Logger(CommissionProcessorService.name);

  constructor(
    @Inject(COMMISSION_REPOSITORY)
    private readonly commissionRepo: CommissionRepository,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    // Check every 15 seconds for sub-orders past return window
    setInterval(() => this.processCommissions(), 15_000);
    this.logger.log('Commission processor started (15s interval) — Model 1 margin-based');
  }

  /* ── Background job: process delivered sub-orders ───────────────── */

  async processCommissions() {
    // Distributed lock: prevent multiple instances from processing the same sub-orders
    const acquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!acquired) return; // Another instance is already processing

    try {
      const subOrders = await this.commissionRepo.findDeliveredSubOrders();

      if (subOrders.length === 0) return;

      for (const so of subOrders) {
        const sellerName = so.seller?.sellerShopName || 'Unknown';
        const orderNumber = so.masterOrder.orderNumber;

        const records: CreateCommissionRecordData[] = [];

        for (const item of so.items) {
          // Look up the SellerProductMapping for the settlement price
          const mapping = await this.commissionRepo.getSellerProductMapping(
            so.sellerId,
            item.productId,
            item.variantId,
          );

          // platformPrice = what the customer paid (stored as unitPrice in the OrderItem)
          const platformPrice = Number(item.unitPrice);

          // settlementPrice = what the seller gets per unit (from the mapping)
          // Fallback: if no mapping or no settlementPrice, use 80% of platformPrice as a safe default
          const settlementPrice = mapping?.settlementPrice
            ? Number(mapping.settlementPrice)
            : Math.round(platformPrice * 0.8 * 100) / 100;

          const quantity = item.quantity;

          // Per-unit margin
          const unitMargin = Math.round((platformPrice - settlementPrice) * 100) / 100;

          // Totals
          const totalPlatformAmount = Math.round(platformPrice * quantity * 100) / 100;
          const totalSettlementAmount = Math.round(settlementPrice * quantity * 100) / 100;
          const platformMargin = Math.round((totalPlatformAmount - totalSettlementAmount) * 100) / 100;

          // Populate legacy fields for backward compatibility
          const totalItemPrice = Number(item.totalPrice);
          const rateLabel = `Margin: ${((unitMargin / platformPrice) * 100).toFixed(1)}%`;

          records.push({
            orderItemId: item.id,
            subOrderId: so.id,
            masterOrderId: so.masterOrderId,
            sellerId: so.sellerId,
            productId: item.productId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle || null,
            orderNumber,
            sellerName,

            // Model 1 fields
            platformPrice,
            settlementPrice,
            quantity,
            totalPlatformAmount,
            totalSettlementAmount,
            platformMargin,
            status: 'PENDING',

            // Legacy fields (mapped from new logic)
            unitPrice: platformPrice,
            totalPrice: totalItemPrice,
            commissionType: 'MARGIN_BASED',
            commissionRate: rateLabel,
            unitCommission: unitMargin,
            totalCommission: platformMargin,
            adminEarning: platformMargin,
            productEarning: totalSettlementAmount,
          });
        }

        await this.commissionRepo.processSubOrderCommission(so.id, records);

        this.logger.log(
          `Commission processed for sub-order ${so.id} (order ${so.masterOrder.orderNumber})`,
        );
      }
    } catch (err) {
      this.logger.error('Commission processing error', err);
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  /* ── Admin: commission records ──────────────────────────────────── */

  async getCommissionRecords(filter: CommissionRecordFilter, page: number, limit: number) {
    return this.commissionRepo.getCommissionRecords(filter, page, limit);
  }

  /* ── Admin: summary ─────────────────────────────────────────────── */

  async getAdminCommissionSummary() {
    return this.commissionRepo.getAdminCommissionSummary();
  }

  /* ── Admin: settings ────────────────────────────────────────────── */

  async getCommissionSettings() {
    return this.commissionRepo.getCommissionSettings();
  }

  async updateCommissionSettings(data: CommissionSettingsData) {
    return this.commissionRepo.upsertCommissionSettings(data);
  }

  /* ── Seller: commission records ─────────────────────────────────── */

  async getSellerCommissionRecords(
    sellerId: string,
    filter: Omit<CommissionRecordFilter, 'sellerId' | 'commissionType'>,
    page: number,
    limit: number,
  ) {
    return this.commissionRepo.getSellerCommissionRecords(sellerId, filter, page, limit);
  }
}
