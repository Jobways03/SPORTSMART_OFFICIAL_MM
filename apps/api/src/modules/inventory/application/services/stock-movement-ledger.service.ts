import { Injectable, Logger } from '@nestjs/common';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import type { StockMovementKind as PrismaStockMovementKind } from '@prisma/client';

/**
 * Phase 4.5 (2026-05-16) — StockMovement audit ledger.
 *
 * Background: every stock-changing action (reserve, release, confirm,
 * damage write-off, manual adjustment, return-receive) needs to be
 * captured in an append-only audit so finance + ops can answer
 * "where did these 50 units go?" without rebuilding state from
 * incidents.
 *
 * Storage: rides on the existing `AuditLog` table (module='inventory',
 * resource='SellerProductMapping' or 'OwnBrandStock'). Each write goes
 * through `AuditPublicFacade.writeAuditLog`, which hashes the row into
 * the tamper-evident chain — so the stock ledger inherits the same
 * compliance properties as the rest of the platform's audit trail.
 *
 * Once query patterns settle, a dedicated `StockMovement` table with
 * a (mappingId, createdAt) index will be cheap to add — the audit
 * rows act as the migration's reference data. This service's API
 * stays stable through that migration.
 *
 * Movement kinds:
 *   - RESERVED       — checkout reserved N units (TTL 15 min)
 *   - RELEASED       — reservation expired or cart cancelled
 *   - CONFIRMED      — order placed; reservation became a real sale
 *   - DEDUCTED       — direct stock decrement (rare; bypasses reserve)
 *   - RESTOCKED      — return received in good condition
 *   - WRITE_OFF      — damaged stock removed from sellable inventory
 *   - MANUAL_ADJUST  — admin correction
 *   - INITIAL        — seeded value when mapping created
 */
export type StockMovementKind =
  | 'RESERVED'
  | 'RELEASED'
  | 'CONFIRMED'
  | 'DEDUCTED'
  | 'RESTOCKED'
  | 'WRITE_OFF'
  | 'MANUAL_ADJUST'
  | 'INITIAL'
  // Phase 53 (2026-05-21) — extended to cover franchise damage/loss
  // patterns + audit-driven corrections.
  | 'DAMAGE'
  | 'LOSS'
  | 'AUDIT_CORRECTION';

export interface StockMovementInput {
  /** SellerProductMapping id or OwnBrandStock id depending on `resource`. */
  resourceId: string;
  resource: 'SellerProductMapping' | 'OwnBrandStock' | 'FranchiseStock';
  kind: StockMovementKind;
  /** Quantity change. Always positive — `kind` encodes the direction. */
  quantityDelta: number;
  /** Stock totals before and after — for audit recompute. */
  beforeStockQty: number;
  afterStockQty: number;
  beforeReservedQty?: number;
  afterReservedQty?: number;
  /** Free-text reason for the change. */
  reason: string;
  /** Cross-reference: order, return, write-off ticket id, etc. */
  referenceType?: string;
  referenceId?: string;
  /** Actor identification — admin id when manual, 'SYSTEM' for crons. */
  actorId?: string;
  actorRole?: string;
}

@Injectable()
export class StockMovementLedgerService {
  private readonly logger = new Logger(StockMovementLedgerService.name);

  constructor(
    private readonly audit: AuditPublicFacade,
    // Phase 4 follow-up (2026-05-16) — dedicated StockMovement table
    // landed. The service now dual-writes: the new typed row gives
    // operators an indexed (mappingId, createdAt) drill-down, while
    // the audit-log path keeps the tamper-evident chain coverage
    // during the soak window. Once query-pattern confidence is high
    // the audit-log half can drop.
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Record a stock movement. Fire-and-forget at the call site —
   * write failures are logged but do not throw, so a logging
   * outage cannot strand a real stock change.
   *
   * Persists to TWO sinks:
   *
   *   1. `stock_movements` (new typed table, only for
   *       resource='SellerProductMapping' rows; OWN_BRAND /
   *       FRANCHISE follow in a future PR when their respective
   *       FK tables are wired).
   *   2. `audit_logs` (tamper-evident chain, all resources).
   *      Shape:
   *        - module     = 'inventory'
   *        - action     = `STOCK_${kind}`
   *        - resource   = `SellerProductMapping` (or other)
   *        - resourceId = the mapping id
   *        - oldValue   = { stockQty, reservedQty }
   *        - newValue   = { stockQty, reservedQty }
   *        - metadata   = { kind, quantityDelta, reason, ... }
   */
  async record(input: StockMovementInput): Promise<void> {
    // 1. Typed table write (only for SellerProductMapping — other
    //    inventory hosts get added in a follow-up PR once their FK
    //    tables exist).
    if (input.resource === 'SellerProductMapping') {
      try {
        await this.prisma.stockMovement.create({
          data: {
            mappingId: input.resourceId,
            kind: input.kind as PrismaStockMovementKind,
            quantityDelta: input.quantityDelta,
            beforeStockQty: input.beforeStockQty,
            afterStockQty: input.afterStockQty,
            beforeReservedQty: input.beforeReservedQty ?? null,
            afterReservedQty: input.afterReservedQty ?? null,
            reason: input.reason,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            actorId: input.actorId ?? null,
            // Phase 53 (2026-05-21) — default flipped from 'SYSTEM'
            // to 'UNKNOWN' so a future code path that forgets to
            // pass actorRole is immediately visible in forensic
            // queries (audit Gap #15). 'SYSTEM' should be explicit
            // for cron-driven writes.
            actorRole: input.actorRole ?? 'UNKNOWN',
          },
        });
      } catch (err) {
        // Don't return — even if the typed write fails, the audit-log
        // write below should still fire. The drill-down view loses
        // this single row, but compliance evidence is preserved.
        this.logger.warn(
          `Failed to record StockMovement row for ${input.resourceId} kind=${input.kind}: ${(err as Error).message}`,
        );
      }
    }

    // 2. Audit-log write — tamper-evident chain, kept during soak.
    try {
      await this.audit.writeAuditLog({
        actorId: input.actorId,
        actorRole: input.actorRole ?? 'UNKNOWN',
        action: `STOCK_${input.kind}`,
        module: 'inventory',
        resource: input.resource,
        resourceId: input.resourceId,
        oldValue: {
          stockQty: input.beforeStockQty,
          reservedQty: input.beforeReservedQty,
        },
        newValue: {
          stockQty: input.afterStockQty,
          reservedQty: input.afterReservedQty,
        },
        metadata: {
          kind: input.kind,
          quantityDelta: input.quantityDelta,
          reason: input.reason,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record audit-log row for ${input.resource}:${input.resourceId} kind=${input.kind}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Batch helper — used by crons that flip many reservations at once
   * (e.g. ReservationExpirySweepCron). Iterates so one bad row
   * doesn't strand the rest.
   */
  async recordMany(inputs: StockMovementInput[]): Promise<void> {
    for (const input of inputs) {
      await this.record(input);
    }
  }
}
