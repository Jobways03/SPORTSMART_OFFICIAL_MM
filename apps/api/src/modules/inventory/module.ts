import { Module } from '@nestjs/common';
import { InventoryPublicFacade } from './application/facades/inventory-public.facade';
import { InventoryManagementService } from './application/services/inventory-management.service';
import { LowStockAlertService } from './application/services/low-stock-alert.service';
import { StockMovementLedgerService } from './application/services/stock-movement-ledger.service';
import { SellerInventoryController } from './presentation/controllers/seller-inventory.controller';
import { AdminInventoryController } from './presentation/controllers/admin-inventory.controller';
import { AdminLowStockAlertsController } from './presentation/controllers/admin-low-stock-alerts.controller';
import { LowStockSweepCron } from './application/jobs/low-stock-sweep.cron';
import { ReservationExpirySweepCron } from './application/jobs/reservation-expiry-sweep.cron';
import { PrismaInventoryManagementRepository } from './infrastructure/repositories/prisma-inventory-management.repository';
import { INVENTORY_MANAGEMENT_REPOSITORY } from './domain/repositories/inventory-management.repository.interface';
import { FranchiseModule } from '../franchise/module';

// Guards
import { SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

@Module({
  // FranchiseModule exports FranchisePublicFacade, which the admin
  // inventory service uses to merge franchise stock into the unified
  // overview / low-stock / out-of-stock queries.
  imports: [FranchiseModule],
  controllers: [
    SellerInventoryController,
    AdminInventoryController,
    AdminLowStockAlertsController,
  ],
  providers: [
    InventoryPublicFacade,
    InventoryManagementService,
    LowStockAlertService,
    // Phase 4.5 (2026-05-16) — StockMovement audit ledger. Rides on
    // the existing AuditLog tamper-evident chain (no migration). Will
    // be promoted to a dedicated StockMovement table once query
    // patterns settle.
    StockMovementLedgerService,
    // Sprint 4 Story 3.4 — auto-sweep cron. Manual sweep endpoint still
    // available; the cron makes the steady-state case work without
    // operator intervention.
    LowStockSweepCron,
    // Phase 4.4 (2026-05-16) — global expiry sweep on the leader
    // replica. Flips RESERVED → EXPIRED past TTL and decrements
    // mapping.reservedQty atomically.
    ReservationExpirySweepCron,
    SellerAuthGuard,
    AdminAuthGuard,
    {
      provide: INVENTORY_MANAGEMENT_REPOSITORY,
      useClass: PrismaInventoryManagementRepository,
    },
  ],
  exports: [
    InventoryPublicFacade,
    LowStockAlertService,
    StockMovementLedgerService,
  ],
})
export class InventoryModule {}
