import { Injectable, Inject, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  ProcurementRepository,
  PROCUREMENT_REPOSITORY,
} from '../../domain/repositories/procurement.repository.interface';
import {
  FranchiseCatalogRepository,
  FRANCHISE_CATALOG_REPOSITORY,
} from '../../domain/repositories/franchise-catalog.repository.interface';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { FranchiseInventoryService } from './franchise-inventory.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ForbiddenAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { FranchiseCommissionService } from './franchise-commission.service';

@Injectable()
export class ProcurementService {
  constructor(
    @Inject(PROCUREMENT_REPOSITORY)
    private readonly procurementRepo: ProcurementRepository,
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly commissionService: FranchiseCommissionService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    // Phase 235/236 — hash-chained audit trail for procurement transitions.
    // @Optional so the manual-construction unit specs (which don't wire it) keep
    // working; AuditPublicFacade is @Global so the live app always injects it.
    @Optional() private readonly auditFacade?: AuditPublicFacade,
  ) {
    this.logger.setContext('ProcurementService');
  }

  /**
   * Phase 235/236 — best-effort hash-chained audit_logs row for a procurement
   * transition. Mirrors recordProcurementEvent (which is the in-tx history) but
   * writes to the tamper-evident cross-module audit chain. Never throws back
   * into the caller.
   */
  private async writeProcurementAudit(args: {
    actorId: string | null;
    actorRole: 'ADMIN' | 'FRANCHISE' | 'SYSTEM';
    action: string;
    resourceId: string;
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditFacade) return;
    await this.auditFacade
      .writeAuditLog({
        actorId: args.actorId ?? 'SYSTEM',
        actorRole: args.actorRole,
        action: args.action,
        module: 'franchise',
        resource: 'ProcurementRequest',
        resourceId: args.resourceId,
        oldValue: args.oldValue,
        newValue: args.newValue,
      } as any)
      .catch(() => undefined);
  }

  /**
   * Phase 159p (audit #12) — append one row to the procurement transition
   * history. Pass `tx` to keep the history atomic with the transition that
   * produced it (approve / dispatch / receive run in a transaction).
   */
  private async recordProcurementEvent(
    args: {
      procurementRequestId: string;
      action: string;
      fromStatus?: string | null;
      toStatus: string;
      actorId?: string | null;
      actorType: 'ADMIN' | 'FRANCHISE' | 'SYSTEM';
      reason?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.procurementRequestEvent.create({
      data: {
        procurementRequestId: args.procurementRequestId,
        action: args.action,
        fromStatus: args.fromStatus ?? null,
        toStatus: args.toStatus,
        actorId: args.actorId ?? null,
        actorType: args.actorType,
        reason: args.reason ?? null,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Franchise-facing methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a new procurement request (DRAFT).
   */
  async createRequest(
    franchiseId: string,
    items: Array<{ productId: string; variantId?: string; quantity: number }>,
    opts?: { notes?: string | null; requestedByStaffId?: string | null },
  ) {
    if (!items || items.length === 0) {
      throw new BadRequestAppException(
        'At least one item is required to create a procurement request',
      );
    }

    // Look up the franchise to get procurementFeeRate
    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise) {
      throw new NotFoundAppException('Franchise not found');
    }
    if (franchise.status !== 'ACTIVE' && franchise.status !== 'APPROVED') {
      throw new ForbiddenAppException(
        'Procurement is only available for active franchises',
      );
    }
    if (franchise.contractEndDate && new Date() > new Date(franchise.contractEndDate)) {
      throw new ForbiddenAppException(
        'Franchise contract has expired — cannot create procurement requests',
      );
    }

    // Phase 159l (audit #12) — the fee rate is SNAPSHOT onto the request here
    // at creation time and persisted on the request header (see below). This
    // is deliberate: a later change to the franchise's fee rate must NOT
    // retroactively re-price an in-flight request. Approval/settlement read
    // `request.procurementFeeRate`, never the live franchise rate.
    const procurementFeeRate = Number(franchise.procurementFeeRate ?? 5);

    // Phase 235 — batch the product + variant resolution (was 2 of the 3
    // per-item queries). The catalog-mapping approved/active check stays
    // per-item to preserve its exact (productId, variantId) matching semantics,
    // now bounded by the DTO's @ArrayMaxSize(100).
    const productIds = [...new Set(items.map((i) => i.productId))];
    const variantIds = [
      ...new Set(
        items.map((i) => i.variantId).filter((v): v is string => !!v),
      ),
    ];
    const [products, variants] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true, basePrice: true },
      }),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve(
            [] as Array<{ id: string; title: string | null }>,
          ),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));

    // Validate all items have catalog mappings and resolve product info
    const resolvedItems: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      productTitle: string;
      variantTitle?: string;
      requestedQty: number;
      mrpSnapshot?: number | null;
    }> = [];

    for (const item of items) {
      // Phase 159n (audit #2) — require an APPROVED + active mapping so a
      // franchise can't raise procurement for a SKU the admin hasn't vetted.
      const mapping = await this.catalogRepo.findApprovedActiveByFranchiseAndProduct(
        franchiseId,
        item.productId,
        item.variantId ?? null,
      );

      if (!mapping) {
        throw new BadRequestAppException(
          `Product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''} is not an approved, active mapping in your catalog`,
        );
      }

      const product = productById.get(item.productId);
      resolvedItems.push({
        productId: item.productId,
        variantId: item.variantId,
        globalSku: mapping.globalSku,
        productTitle: product?.title ?? '',
        variantTitle: item.variantId
          ? variantById.get(item.variantId)?.title ?? undefined
          : undefined,
        requestedQty: item.quantity,
        // Phase 237 — MRP (customer base price) snapshot at creation, so finance
        // can compute procurement margin against the price that existed when the
        // request was raised even after basePrice later changes.
        mrpSnapshot:
          product?.basePrice != null ? Number(product.basePrice) : null,
      });
    }

    // Phase 235 — atomic create: allocate the request number + write the header
    // + items in ONE transaction. Pre-235 these were 3 separate writes, so a
    // crash between the header and items left an orphan empty DRAFT with a
    // burned request number; the number is now allocated INSIDE the tx so a
    // failure rolls it back.
    const { request, createdItems } = await this.prisma.$transaction(
      async (tx) => {
        const requestNumber = await this.procurementRepo.nextRequestNumberInTx(tx);
        const created = await this.procurementRepo.create(
          {
            franchiseId,
            requestNumber,
            procurementFeeRate,
            notes: opts?.notes ?? null,
            requestedByStaffId: opts?.requestedByStaffId ?? null,
          },
          tx,
        );
        const createdItemRows = await this.procurementRepo.createItems(
          created.id,
          resolvedItems,
          tx,
        );
        return { request: created, createdItems: createdItemRows };
      },
    );

    // Phase 235 — hash-chained audit row (best-effort; the in-flow trail
    // continues via ProcurementRequestEvent on subsequent transitions).
    await this.writeProcurementAudit({
      actorId: opts?.requestedByStaffId ?? franchiseId,
      actorRole: 'FRANCHISE',
      action: 'PROCUREMENT_REQUEST_CREATED',
      resourceId: request.id,
      newValue: {
        requestNumber: request.requestNumber,
        franchiseId,
        itemCount: createdItems.length,
      },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} created for franchise ${franchiseId} with ${createdItems.length} items`,
    );

    return { ...request, items: createdItems };
  }

  /**
   * Submit a draft request for admin review.
   */
  async submitRequest(franchiseId: string, requestId: string) {
    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (
      !franchise ||
      (franchise.status !== 'ACTIVE' && franchise.status !== 'APPROVED')
    ) {
      throw new ForbiddenAppException(
        'Cannot submit procurement — franchise is not active',
      );
    }

    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException(
        'You do not have access to this procurement request',
      );
    }
    if (request.status !== 'DRAFT') {
      throw new BadRequestAppException(
        `Cannot submit a request in ${request.status} status. Only DRAFT requests can be submitted.`,
      );
    }

    // Phase 7 (2026-05-16) — compute the approval-SLA deadline so the
    // breach cron has something to scan against. The deadline is wall
    // clock; we don't subtract weekends/holidays because admins are
    // available around the clock for procurement triage.
    const requestedAt = new Date();
    const slaHours = this.env.getNumber('PROCUREMENT_APPROVAL_SLA_HOURS', 48);
    const slaApproveBy = new Date(
      requestedAt.getTime() + slaHours * 60 * 60 * 1000,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await this.procurementRepo.update(
        requestId,
        {
          status: 'SUBMITTED',
          requestedAt,
          slaApproveBy,
          // Clear any stale breach flag so the SLA cron starts fresh.
          slaBreachedAt: null,
        },
        tx,
      );
      await this.recordProcurementEvent(
        {
          procurementRequestId: requestId,
          action: 'SUBMITTED',
          fromStatus: 'DRAFT',
          toStatus: 'SUBMITTED',
          actorId: franchiseId,
          actorType: 'FRANCHISE',
        },
        tx,
      );
      return u;
    });

    await this.eventBus.publish({
      eventName: 'procurement.submitted',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId,
        requestNumber: request.requestNumber,
        slaApproveBy,
      },
    });

    this.logger.log(`Procurement request ${request.requestNumber} submitted`);

    return updated;
  }

  /**
   * List franchise's own procurement requests.
   */
  async getMyRequests(
    franchiseId: string,
    page: number,
    limit: number,
    status?: string,
  ) {
    return this.procurementRepo.findByFranchiseId(franchiseId, {
      page,
      limit,
      status,
    });
  }

  /**
   * Cancel a DRAFT or SUBMITTED procurement request.
   */
  async cancelRequest(
    franchiseId: string,
    requestId: string,
    reason?: string,
    actorId?: string,
  ) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException('Not your request');
    }

    // Can only cancel DRAFT or SUBMITTED requests
    const cancellableStatuses = ['DRAFT', 'SUBMITTED'];
    if (!cancellableStatuses.includes(request.status)) {
      throw new BadRequestAppException(
        `Cannot cancel request in ${request.status} status. Only DRAFT and SUBMITTED requests can be cancelled.`,
      );
    }

    const fromStatus = request.status;
    const cancelActor = actorId ?? franchiseId;
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // Phase 236 — CAS: only flip if STILL cancellable, so a concurrent admin
      // approve/dispatch can't be silently overwritten (the pre-read status is
      // not a lock). Phase 235/236 — stamp the dedicated cancelledBy/At/reason
      // columns instead of overwriting the franchise's free-form `notes`.
      const cas = await tx.procurementRequest.updateMany({
        where: { id: requestId, status: { in: cancellableStatuses as any } },
        data: {
          status: 'CANCELLED',
          cancelledBy: cancelActor,
          cancelledAt: now,
          cancellationReason: reason ?? null,
        },
      });
      if (cas.count === 0) {
        throw new ConflictAppException(
          'Request is no longer cancellable — it may have just been approved or cancelled by another action.',
        );
      }
      await this.recordProcurementEvent(
        {
          procurementRequestId: requestId,
          action: 'CANCELLED',
          fromStatus,
          toStatus: 'CANCELLED',
          actorId: cancelActor,
          actorType: 'FRANCHISE',
          reason: reason ?? null,
        },
        tx,
      );
      return this.procurementRepo.findByIdWithItems(requestId, tx);
    });

    await this.writeProcurementAudit({
      actorId: cancelActor,
      actorRole: 'FRANCHISE',
      action: 'PROCUREMENT_CANCELLED',
      resourceId: requestId,
      oldValue: { status: fromStatus },
      newValue: { status: 'CANCELLED', reason: reason ?? null },
    });

    this.logger.log(
      `Procurement ${requestId} cancelled by franchise ${franchiseId}`,
    );

    return updated;
  }

  /**
   * Get a single procurement request with items (franchise-facing).
   */
  async getRequestDetail(franchiseId: string, requestId: string) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException(
        'You do not have access to this procurement request',
      );
    }
    const damageClaims = await this.listDamageClaims(requestId);
    return { ...request, damageClaims };
  }

  /**
   * Franchise confirms receipt of dispatched goods.
   * This is when stock actually gets added to inventory.
   */
  async confirmReceipt(
    franchiseId: string,
    requestId: string,
    items: Array<{
      itemId: string;
      receivedQty: number;
      damagedQty?: number;
      damageImageFileIds?: string[];
    }>,
    actorId?: string,
  ) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException(
        'You do not have access to this procurement request',
      );
    }
    // Phase 55 (2026-05-21) — allow second-pass top-ups from
    // PARTIALLY_RECEIVED but now process only the DELTA between the
    // already-recorded receivedQty/damagedQty and the new submission
    // so a retried POST / network blip / accidental double-click
    // does NOT add stock twice (audit Gap #1).
    if (
      request.status !== 'DISPATCHED' &&
      request.status !== 'PARTIALLY_RECEIVED'
    ) {
      throw new BadRequestAppException(
        `Cannot confirm receipt for a request in ${request.status} status. Only DISPATCHED or PARTIALLY_RECEIVED requests can be received.`,
      );
    }

    const effectiveActorId = actorId ?? franchiseId;
    type StockSnapshot = {
      productId: string;
      variantId: string | null;
      ledgerEntryIds: string[];
      goodDelta: number;
      damagedDelta: number;
      onHandQty: number;
      availableQty: number;
      damagedQty: number;
    };
    const affected: StockSnapshot[] = [];

    // Phase 55 — single outer transaction wraps per-item processing
    // + final status + finance totals so a mid-loop crash rolls back
    // the whole batch (audit Gaps #4 + #5).
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const receiptItem of items) {
        const existingItem = await this.procurementRepo.findItemById(
          receiptItem.itemId,
          tx,
        );
        if (!existingItem) {
          throw new NotFoundAppException(
            `Procurement item ${receiptItem.itemId} not found`,
          );
        }
        if (existingItem.procurementRequestId !== requestId) {
          throw new BadRequestAppException(
            `Item ${receiptItem.itemId} does not belong to this procurement request`,
          );
        }

        // Skip items that were rejected — they were never dispatched.
        if (existingItem.status === 'REJECTED') {
          this.logger.warn(
            `Skipping receipt for rejected item ${receiptItem.itemId} in request ${request.requestNumber}`,
          );
          continue;
        }

        // Phase 55 — over-receipt guard (audit Gap #11). Supplier
        // mis-counts that ship extra units shouldn't silently inflate
        // franchise stock; force the franchise + admin to reconcile.
        if (receiptItem.receivedQty > existingItem.dispatchedQty) {
          throw new BadRequestAppException(
            `Item ${receiptItem.itemId}: receivedQty (${receiptItem.receivedQty}) exceeds dispatchedQty (${existingItem.dispatchedQty}). Resolve over-receipt with admin before recording.`,
          );
        }

        const newReceivedQty = receiptItem.receivedQty;
        const newDamagedQty = receiptItem.damagedQty ?? 0;
        const oldReceivedQty = existingItem.receivedQty ?? 0;
        const oldDamagedQty = existingItem.damagedQty ?? 0;

        // Phase 55 — delta math is the heart of the idempotency fix.
        // goodQty = receivedQty - damagedQty; we only add the
        // INCREASE in goodQty since the last submission.
        const newGoodQty = newReceivedQty - newDamagedQty;
        const oldGoodQty = oldReceivedQty - oldDamagedQty;
        const goodDelta = newGoodQty - oldGoodQty;
        const damagedDelta = newDamagedQty - oldDamagedQty;

        // A negative delta would imply the franchise is decrementing
        // an already-committed receipt — refuse it. Admins reverse
        // bad receipts via the adjustment flow, not via this endpoint.
        if (newReceivedQty < oldReceivedQty) {
          throw new BadRequestAppException(
            `Item ${receiptItem.itemId}: receivedQty (${newReceivedQty}) is less than previously-confirmed receivedQty (${oldReceivedQty}). Use the inventory adjustment flow to reverse.`,
          );
        }
        if (newDamagedQty < oldDamagedQty) {
          throw new BadRequestAppException(
            `Item ${receiptItem.itemId}: damagedQty (${newDamagedQty}) is less than previously-confirmed damagedQty (${oldDamagedQty}).`,
          );
        }

        // Compute item status from the NEW absolute values.
        let itemStatus = 'RECEIVED';
        if (newReceivedQty === 0) {
          itemStatus = 'SHORT';
        } else if (newDamagedQty > 0 && newDamagedQty >= newReceivedQty) {
          itemStatus = 'DAMAGED';
        } else if (newReceivedQty < existingItem.dispatchedQty) {
          itemStatus = 'SHORT';
        }

        await this.procurementRepo.updateItem(
          receiptItem.itemId,
          {
            receivedQty: newReceivedQty,
            damagedQty: newDamagedQty,
            status: itemStatus,
          },
          tx,
        );

        const ledgerEntryIds: string[] = [];
        let lastStock: any = null;

        // Phase 55 — add the goodDelta (not the absolute goodQty) so
        // a retried POST adds zero. Only fires when there's a real
        // increment.
        if (goodDelta > 0) {
          const result = await this.inventoryService.addProcurementStock(
            franchiseId,
            existingItem.productId,
            existingItem.variantId ?? null,
            existingItem.globalSku,
            goodDelta,
            requestId,
            effectiveActorId,
            undefined,
            'FRANCHISE_USER',
            tx,
          );
          ledgerEntryIds.push(result.ledgerEntry.id);
          lastStock = result.stock;
        }

        // Damage now requires admin review with photo proof. Rather than write
        // the units straight into FranchiseStock.damagedQty (and keep billing
        // the franchise for them), raise a PENDING claim carrying the images.
        // An admin later APPROVES (→ damagedQty + DAMAGE ledger, units dropped
        // from payable) or REJECTS (→ units become saleable, still billed). The
        // good units already committed above; only the damaged portion waits.
        if (damagedDelta > 0) {
          const fileIds = receiptItem.damageImageFileIds ?? [];
          if (fileIds.length === 0) {
            throw new BadRequestAppException(
              `Item ${receiptItem.itemId}: at least one damage photo is required to claim ${damagedDelta} damaged unit(s).`,
            );
          }
          // The referenced files must exist (uploaded via /files/upload).
          const foundFiles = await tx.fileMetadata.count({
            where: { id: { in: fileIds } },
          });
          if (foundFiles !== fileIds.length) {
            throw new BadRequestAppException(
              `Item ${receiptItem.itemId}: one or more damage photo references are invalid.`,
            );
          }
          await tx.procurementDamageClaim.create({
            data: {
              procurementRequestId: requestId,
              procurementItemId: receiptItem.itemId,
              productId: existingItem.productId,
              variantId: existingItem.variantId ?? null,
              globalSku: existingItem.globalSku,
              claimedQty: damagedDelta,
              status: 'PENDING',
              raisedByActorId: effectiveActorId,
              images: {
                create: fileIds.map((fileId) => ({ fileId })),
              },
            },
          });
        }

        if (ledgerEntryIds.length > 0 && lastStock) {
          affected.push({
            productId: existingItem.productId,
            variantId: existingItem.variantId ?? null,
            ledgerEntryIds,
            goodDelta,
            damagedDelta,
            onHandQty: lastStock.onHandQty,
            availableQty: lastStock.availableQty,
            damagedQty: lastStock.damagedQty,
          });
        }
      }

      // Calculate totals inside the same transaction.
      const totals = await this.procurementRepo.calculateTotals(requestId, tx);

      // Decide final request status by inspecting every non-REJECTED
      // item. The re-fetch lives inside the tx so it sees our writes.
      const refreshed = await this.procurementRepo.findByIdWithItems(
        requestId,
        tx,
      );
      const actionableItems = (refreshed?.items ?? []).filter(
        (i: any) => i.status !== 'REJECTED',
      );
      const anyShort = actionableItems.some(
        (i: any) => i.status === 'SHORT' || i.status === 'PENDING',
      );
      const finalStatus = anyShort ? 'PARTIALLY_RECEIVED' : 'RECEIVED';

      // Phase 236 — CAS on the request status (the pre-read at method entry is
      // not a lock); stamp receivedBy (the franchise actor who confirmed).
      const cas = await tx.procurementRequest.updateMany({
        where: {
          id: requestId,
          status: { in: ['DISPATCHED', 'PARTIALLY_RECEIVED'] },
        },
        data: {
          status: finalStatus,
          receivedBy: effectiveActorId,
          ...(finalStatus === 'RECEIVED' ? { receivedAt: new Date() } : {}),
          totalApprovedAmount: totals.totalApprovedAmount,
          procurementFeeAmount: totals.procurementFeeAmount,
          finalPayableAmount: totals.finalPayableAmount,
        },
      });
      if (cas.count === 0) {
        throw new ConflictAppException(
          'Request is no longer in a receivable state.',
        );
      }
      const u = await this.procurementRepo.findByIdWithItems(requestId, tx);
      await this.recordProcurementEvent(
        {
          procurementRequestId: requestId,
          action: finalStatus,
          fromStatus: request.status,
          toStatus: finalStatus,
          actorId: effectiveActorId,
          actorType: 'FRANCHISE',
        },
        tx,
      );
      return u;
    });

    // Phase 55 — rich event payload (audit Gaps #12 + #15). Includes
    // per-item ledgerEntryIds + post-write stock snapshots so
    // subscribers (admin UI, low-stock recompute, finance) can act
    // without re-querying.
    const finalStatus = updated.status;
    await this.eventBus.publish({
      eventName:
        finalStatus === 'RECEIVED'
          ? 'procurement.received'
          : 'procurement.partially_received',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId,
        requestNumber: request.requestNumber,
        finalPayableAmount: updated.finalPayableAmount,
        actorId: effectiveActorId,
        items: affected,
      },
    });

    // Phase 55 — emit a per-stock change event so a low-stock alert
    // subscriber can recompute immediately (audit Gap #8). Failure
    // is non-fatal; cron sweep is the backstop.
    for (const a of affected) {
      this.eventBus
        .publish({
          eventName: 'inventory.franchise_stock.changed',
          aggregate: 'FranchiseStock',
          aggregateId: `${franchiseId}:${a.productId}:${a.variantId ?? 'null'}`,
          occurredAt: new Date(),
          payload: {
            franchiseId,
            productId: a.productId,
            variantId: a.variantId,
            onHandQty: a.onHandQty,
            availableQty: a.availableQty,
            damagedQty: a.damagedQty,
            goodDelta: a.goodDelta,
            damagedDelta: a.damagedDelta,
          },
        })
        .catch(() => {});
    }

    await this.writeProcurementAudit({
      actorId: effectiveActorId,
      actorRole: 'FRANCHISE',
      action: 'PROCUREMENT_RECEIVED',
      resourceId: requestId,
      oldValue: { status: request.status },
      newValue: { status: finalStatus },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} ${finalStatus === 'RECEIVED' ? 'fully received' : 'partially received'} by franchise (actor=${effectiveActorId})`,
    );

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════
  // Admin-facing methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin view of all procurement requests.
   */
  async listAllRequests(
    page: number,
    limit: number,
    status?: string,
    franchiseId?: string,
    search?: string,
  ) {
    return this.procurementRepo.findAllPaginated({
      page,
      limit,
      status,
      franchiseId,
      search,
    });
  }

  /**
   * Admin approves a procurement request, setting pricing per item.
   */
  async approveRequest(
    adminId: string,
    requestId: string,
    items: Array<{
      itemId: string;
      approvedQty: number;
      landedUnitCost: number;
      sourceSellerId?: string;
    }>,
  ) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.status !== 'SUBMITTED') {
      throw new BadRequestAppException(
        `Cannot approve a request in ${request.status} status. Only SUBMITTED requests can be approved.`,
      );
    }

    const feeRate = new Prisma.Decimal(request.procurementFeeRate);

    // Phase 159p (audit #9) — the per-item loop, status decision, totals
    // recompute, and request update now run in ONE transaction (tx threaded to
    // every repo call) so a mid-loop failure rolls the whole approval back
    // instead of leaving some items APPROVED, some PENDING, and a stale status.
    const { updated, requestStatus, totals } = await this.prisma.$transaction(
      async (tx) => {
        const processedItems: Array<{ itemId: string; status: string }> = [];

        for (const approveItem of items) {
          const existingItem = await this.procurementRepo.findItemById(
            approveItem.itemId,
            tx,
          );
          if (!existingItem) {
            throw new NotFoundAppException(
              `Procurement item ${approveItem.itemId} not found`,
            );
          }
          if (existingItem.procurementRequestId !== requestId) {
            throw new BadRequestAppException(
              `Item ${approveItem.itemId} does not belong to this procurement request`,
            );
          }

          // Phase 159p (audit #3) — never approve more than was requested. A
          // fat-fingered (or privilege-escalated) admin could otherwise approve
          // 9 999 units against a 10-unit request, scaling inventory + payable.
          if (approveItem.approvedQty > existingItem.requestedQty) {
            throw new BadRequestAppException(
              `Item ${approveItem.itemId}: approvedQty (${approveItem.approvedQty}) exceeds requestedQty (${existingItem.requestedQty}).`,
            );
          }

          const itemStatus =
            approveItem.approvedQty > 0 ? 'APPROVED' : 'REJECTED';

          if (approveItem.approvedQty > 0) {
            // Phase 159p (audit #13) — Decimal money math (was JS float that
            // drifted by paisa on edge values before hitting the Decimal column).
            const landed = new Prisma.Decimal(approveItem.landedUnitCost);
            const procurementFeePerUnit = landed.times(feeRate).dividedBy(100);
            const finalUnitCostToFranchise = landed.plus(procurementFeePerUnit);

            await this.procurementRepo.updateItem(
              approveItem.itemId,
              {
                approvedQty: approveItem.approvedQty,
                landedUnitCost: landed,
                procurementFeePerUnit,
                finalUnitCostToFranchise,
                sourceSellerId: approveItem.sourceSellerId ?? null,
                status: itemStatus,
              },
              tx,
            );
          } else {
            // Rejected item — zero out costs
            await this.procurementRepo.updateItem(
              approveItem.itemId,
              {
                approvedQty: 0,
                landedUnitCost: 0,
                procurementFeePerUnit: 0,
                finalUnitCostToFranchise: 0,
                sourceSellerId: approveItem.sourceSellerId ?? null,
                status: itemStatus,
              },
              tx,
            );
          }

          processedItems.push({ itemId: approveItem.itemId, status: itemStatus });
        }

        const approvedItems = processedItems.filter((i) => i.status === 'APPROVED');
        const rejectedItems = processedItems.filter((i) => i.status === 'REJECTED');

        let requestStatus: string;
        if (approvedItems.length === 0) {
          requestStatus = 'REJECTED';
        } else if (rejectedItems.length > 0) {
          requestStatus = 'PARTIALLY_APPROVED';
        } else {
          requestStatus = 'APPROVED';
        }

        const totals = await this.procurementRepo.calculateTotals(requestId, tx);

        // Phase 236 — CAS on status='SUBMITTED' so a request cancelled by the
        // franchise between the pre-read and here can't be silently approved
        // (closes the approve-vs-cancel race).
        const cas = await tx.procurementRequest.updateMany({
          where: { id: requestId, status: 'SUBMITTED' },
          data: {
            status: requestStatus as any,
            approvedAt: new Date(),
            approvedBy: adminId,
            totalApprovedAmount: totals.totalApprovedAmount,
            procurementFeeAmount: totals.procurementFeeAmount,
            finalPayableAmount: totals.finalPayableAmount,
          },
        });
        if (cas.count === 0) {
          throw new ConflictAppException(
            'Request is no longer in SUBMITTED state — it may have just been cancelled.',
          );
        }
        const updated = await this.procurementRepo.findByIdWithItems(
          requestId,
          tx,
        );

        await this.recordProcurementEvent(
          {
            procurementRequestId: requestId,
            action: requestStatus,
            fromStatus: 'SUBMITTED',
            toStatus: requestStatus,
            actorId: adminId,
            actorType: 'ADMIN',
          },
          tx,
        );

        return { updated, requestStatus, totals };
      },
    );

    // Persist the admin-entered landed cost for next-time auto-fill.
    //
    // Precedence:
    //   1. If a per-franchise negotiated-price row exists for
    //      (franchiseId, productId, variantId), update IT. That
    //      protects this franchise's deal from platform-wide rate
    //      changes.
    //   2. Otherwise update the variant default (or product default
    //      for product-level mappings) — the platform-wide value that
    //      other franchises fall back to.
    //
    // We intentionally do NOT auto-create the per-franchise override
    // row. Admins create those deliberately in the franchise's
    // procurement-pricing page — approval only maintains whichever
    // record already exists.
    //
    // Best-effort — a write failure here must not roll back the
    // approval. Each item's write is independent.
    for (const approveItem of items) {
      if (approveItem.approvedQty <= 0 || approveItem.landedUnitCost <= 0) {
        continue; // skip rejected items and sentinel zeros
      }
      const original = (request.items as Array<any>).find(
        (i) => i.id === approveItem.itemId,
      );
      if (!original) continue;

      try {
        const existingOverride =
          await this.prisma.franchiseProcurementPrice.findUnique({
            where: {
              // Prisma's composite-unique input type doesn't model
              // the nullable variantId as nullable; the `as any` is
              // the codebase-wide workaround. See admin-franchise-
              // procurement-pricing.controller.ts for the same cast.
              franchiseId_productId_variantId: {
                franchiseId: request.franchiseId,
                productId: original.productId,
                variantId: original.variantId ?? null,
              } as any,
            },
          });

        if (existingOverride) {
          await this.prisma.franchiseProcurementPrice.update({
            where: { id: existingOverride.id },
            data: {
              landedUnitCost: approveItem.landedUnitCost,
              updatedBy: adminId,
              version: { increment: 1 },
            },
          });
          // Append-only history of the override cost set via approval (#4).
          await this.prisma.franchiseProcurementPriceHistory.create({
            data: {
              franchiseId: request.franchiseId,
              productId: original.productId,
              variantId: original.variantId ?? null,
              action: 'APPROVAL_WRITEBACK',
              oldLandedUnitCost: existingOverride.landedUnitCost,
              newLandedUnitCost: approveItem.landedUnitCost,
              changedByAdminId: adminId,
            },
          });
        } else if (original.variantId) {
          // Target procurementPrice (NOT costPrice). costPrice is a
          // display-only field per product policy and is deliberately
          // decoupled from procurement logic.
          //
          // NOTE (audit #2/#10): this writes the PLATFORM-WIDE default, which
          // the franchise-procurement-price-override spec pins as intended
          // "Option A" shared-baseline behaviour (per-franchise secrets use an
          // explicit override row instead). The audit reads it as a
          // cross-franchise leak. That is a deliberate, tested design decision,
          // so it is surfaced for a product call rather than silently flipped.
          await this.prisma.productVariant.update({
            where: { id: original.variantId },
            data: { procurementPrice: approveItem.landedUnitCost },
          });
        } else if (original.productId) {
          await this.prisma.product.update({
            where: { id: original.productId },
            data: { procurementPrice: approveItem.landedUnitCost },
          });
        }
      } catch (err) {
        this.logger.warn(
          `Failed to persist landed cost for item ${approveItem.itemId}: ${(err as Error).message}`,
        );
      }
    }

    await this.eventBus.publish({
      eventName: 'procurement.approved',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        requestStatus,
        totalApprovedAmount: Number(totals.totalApprovedAmount),
      },
    });

    await this.writeProcurementAudit({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'PROCUREMENT_APPROVED',
      resourceId: requestId,
      oldValue: { status: 'SUBMITTED' },
      newValue: { status: requestStatus },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} ${requestStatus} by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Admin rejects a procurement request.
   *
   * `reason` is stored on the dedicated `rejectionReason` column so the
   * free-form `notes` field stays clean. If the existing `notes` field is
   * empty, we also mirror the reason into it so callers that only read
   * `notes` keep working — but canonical source is `rejectionReason`.
   */
  async rejectRequest(adminId: string, requestId: string, reason?: string) {
    const request = await this.procurementRepo.findById(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.status !== 'SUBMITTED') {
      throw new BadRequestAppException(
        `Cannot reject a request in ${request.status} status. Only SUBMITTED requests can be rejected.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await this.procurementRepo.update(
        requestId,
        {
          status: 'REJECTED',
          rejectionReason: reason ?? null,
        },
        tx,
      );
      await this.recordProcurementEvent(
        {
          procurementRequestId: requestId,
          action: 'REJECTED',
          fromStatus: 'SUBMITTED',
          toStatus: 'REJECTED',
          actorId: adminId,
          actorType: 'ADMIN',
          reason: reason ?? null,
        },
        tx,
      );
      return u;
    });

    await this.eventBus.publish({
      eventName: 'procurement.rejected',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        reason,
      },
    });

    await this.writeProcurementAudit({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'PROCUREMENT_REJECTED',
      resourceId: requestId,
      oldValue: { status: 'SUBMITTED' },
      newValue: { status: 'REJECTED', reason: reason ?? null },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} rejected by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Admin marks a procurement request as dispatched. Shipment tracking
   * (number, carrier, ETA) is optional but recommended — it's what the
   * franchise sees on their detail page when the goods are in transit.
   */
  async markDispatched(
    adminId: string,
    requestId: string,
    shipment?: {
      trackingNumber?: string | null;
      carrierName?: string | null;
      expectedDeliveryAt?: Date | null;
    },
    dispatchItems?: Array<{ itemId: string; dispatchedQty: number }>,
  ) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (
      request.status !== 'APPROVED' &&
      request.status !== 'PARTIALLY_APPROVED' &&
      request.status !== 'SOURCING'
    ) {
      throw new BadRequestAppException(
        `Cannot mark as dispatched. Request is in ${request.status} status. Only APPROVED, PARTIALLY_APPROVED, or SOURCING requests can be dispatched.`,
      );
    }

    // Phase 159p (audit #10) — per-item dispatched quantities. An item listed
    // in `dispatchItems` ships that quantity (capped at approvedQty); items not
    // listed ship their full approvedQty (back-compatible all-or-nothing).
    const dispatchMap = new Map<string, number>(
      (dispatchItems ?? []).map((d) => [d.itemId, d.dispatchedQty]),
    );
    const dispatchableItems = request.items.filter(
      (item: any) =>
        item.status === 'APPROVED' ||
        item.status === 'SOURCED' ||
        item.status === 'PENDING',
    );
    // Validate the requested quantities up front so we never half-dispatch.
    for (const [itemId, qty] of dispatchMap.entries()) {
      const item = dispatchableItems.find((i: any) => i.id === itemId);
      if (!item) {
        throw new BadRequestAppException(
          `Dispatch item ${itemId} is not an approved, dispatchable item on this request`,
        );
      }
      if (qty > item.approvedQty) {
        throw new BadRequestAppException(
          `Item ${itemId}: dispatchedQty (${qty}) exceeds approvedQty (${item.approvedQty})`,
        );
      }
    }

    // Phase 159p (audit #9 sibling) — item updates + status flip in one tx.
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of dispatchableItems) {
        await this.procurementRepo.updateItem(
          item.id,
          {
            status: 'DISPATCHED',
            dispatchedQty: dispatchMap.get(item.id) ?? item.approvedQty,
          },
          tx,
        );
      }

      // Phase 236 — CAS on the request status; stamp dispatchedBy (the admin).
      const cas = await tx.procurementRequest.updateMany({
        where: {
          id: requestId,
          status: { in: ['APPROVED', 'PARTIALLY_APPROVED', 'SOURCING'] },
        },
        data: {
          status: 'DISPATCHED',
          dispatchedAt: new Date(),
          dispatchedBy: adminId,
          trackingNumber: shipment?.trackingNumber ?? null,
          carrierName: shipment?.carrierName ?? null,
          expectedDeliveryAt: shipment?.expectedDeliveryAt ?? null,
        },
      });
      if (cas.count === 0) {
        throw new ConflictAppException(
          'Request is no longer in a dispatchable state.',
        );
      }
      const u = await this.procurementRepo.findByIdWithItems(requestId, tx);
      await this.recordProcurementEvent(
        {
          procurementRequestId: requestId,
          action: 'DISPATCHED',
          fromStatus: request.status,
          toStatus: 'DISPATCHED',
          actorId: adminId,
          actorType: 'ADMIN',
        },
        tx,
      );
      return u;
    });

    await this.eventBus.publish({
      eventName: 'procurement.dispatched',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        trackingNumber: shipment?.trackingNumber ?? null,
        carrierName: shipment?.carrierName ?? null,
        expectedDeliveryAt: shipment?.expectedDeliveryAt ?? null,
      },
    });

    await this.writeProcurementAudit({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'PROCUREMENT_DISPATCHED',
      resourceId: requestId,
      oldValue: { status: request.status },
      newValue: {
        status: 'DISPATCHED',
        trackingNumber: shipment?.trackingNumber ?? null,
        carrierName: shipment?.carrierName ?? null,
      },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} dispatched by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Admin settles a received procurement request.
   */
  async settleRequest(adminId: string, requestId: string) {
    const request = await this.procurementRepo.findById(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.status !== 'RECEIVED') {
      throw new BadRequestAppException(
        `Cannot settle a request in ${request.status} status. Only RECEIVED requests can be settled.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Phase 236 — CAS on status='RECEIVED' so a double-clicked settle (or a
      // concurrent transition) can't double-fire.
      const cas = await tx.procurementRequest.updateMany({
        where: { id: requestId, status: 'RECEIVED' },
        data: {
          status: 'SETTLED',
          settledAt: new Date(),
        },
      });
      if (cas.count === 0) {
        throw new ConflictAppException(
          'Request is no longer in RECEIVED state — it may have already been settled.',
        );
      }
      const u = await this.procurementRepo.findByIdWithItems(requestId, tx);
      await this.recordProcurementEvent(
        {
          procurementRequestId: requestId,
          action: 'SETTLED',
          fromStatus: 'RECEIVED',
          toStatus: 'SETTLED',
          actorId: adminId,
          actorType: 'ADMIN',
        },
        tx,
      );
      return u;
    });

    await this.eventBus.publish({
      eventName: 'procurement.settled',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        finalPayableAmount: Number(request.finalPayableAmount),
      },
    });

    // Record finance ledger rows. Phase 159p (audit #8) — post the PRINCIPAL
    // cost as a franchise→HQ payable in addition to the platform fee, so the
    // franchise's total HQ liability is answerable from the ledger.
    const totalLandedCost = Number(request.totalApprovedAmount ?? 0);
    const feeRate = Number(request.procurementFeeRate ?? 0);
    if (totalLandedCost > 0) {
      try {
        await this.commissionService.recordProcurementCost({
          franchiseId: request.franchiseId,
          procurementRequestId: requestId,
          principalAmount: totalLandedCost,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to record procurement principal cost for request ${request.requestNumber}: ${(err as Error).message}`,
        );
      }
    }
    if (totalLandedCost > 0 && feeRate > 0) {
      try {
        await this.commissionService.recordProcurementFee({
          franchiseId: request.franchiseId,
          procurementRequestId: requestId,
          totalLandedCost,
          feeRate,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to record procurement fee for request ${request.requestNumber}: ${(err as Error).message}`,
        );
      }
    }

    await this.writeProcurementAudit({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'PROCUREMENT_SETTLED',
      resourceId: requestId,
      oldValue: { status: 'RECEIVED' },
      newValue: { status: 'SETTLED' },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} settled by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Get a single procurement request with items (admin-facing, no ownership check).
   */
  async getRequestDetailAdmin(requestId: string) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    const damageClaims = await this.listDamageClaims(requestId);
    return { ...request, damageClaims };
  }

  // ═══════════════════════════════════════════════════════════════
  // Procurement damage claims (receipt damage → admin photo review)
  // ═══════════════════════════════════════════════════════════════

  /** All damage claims for a request, newest first, with their image ids. */
  async listDamageClaims(requestId: string) {
    return this.prisma.procurementDamageClaim.findMany({
      where: { procurementRequestId: requestId },
      orderBy: { createdAt: 'desc' },
      include: { images: true },
    });
  }

  /**
   * Admin APPROVES a damage claim: the claimed units are committed to
   * FranchiseStock.damagedQty (+ DAMAGE ledger), the item's approvedDamagedQty
   * grows, and the request payable is recomputed so the franchise no longer
   * pays for them. Returns the updated claim + the new finalPayableAmount.
   */
  async approveDamageClaim(adminId: string, claimId: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.procurementDamageClaim.findUnique({
        where: { id: claimId },
        include: { request: true },
      });
      if (!claim) throw new NotFoundAppException('Damage claim not found');
      if (claim.status !== 'PENDING') {
        throw new BadRequestAppException(
          `Damage claim is already ${claim.status.toLowerCase()}.`,
        );
      }
      const franchiseId = claim.request.franchiseId;

      // Commit the damaged units to stock (damagedQty + DAMAGE ledger row).
      await this.inventoryService.addDamagedFromProcurement(
        franchiseId,
        claim.productId,
        claim.variantId,
        claim.globalSku,
        claim.claimedQty,
        claim.procurementRequestId,
        adminId,
        tx,
      );

      // Accept the damage on the item so billing excludes these units.
      await tx.procurementRequestItem.update({
        where: { id: claim.procurementItemId },
        data: { approvedDamagedQty: { increment: claim.claimedQty } },
      });

      await tx.procurementDamageClaim.update({
        where: { id: claimId },
        data: {
          status: 'APPROVED',
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        },
      });

      // Recompute totals now that approvedDamagedQty changed → payable drops.
      const totals = await this.procurementRepo.calculateTotals(
        claim.procurementRequestId,
        tx,
      );
      await tx.procurementRequest.update({
        where: { id: claim.procurementRequestId },
        data: {
          totalApprovedAmount: totals.totalApprovedAmount,
          procurementFeeAmount: totals.procurementFeeAmount,
          finalPayableAmount: totals.finalPayableAmount,
        },
      });

      await this.recordProcurementEvent(
        {
          procurementRequestId: claim.procurementRequestId,
          action: 'DAMAGE_CLAIM_APPROVED',
          fromStatus: claim.request.status,
          toStatus: claim.request.status,
          actorId: adminId,
          actorType: 'ADMIN',
          reason: `Approved damage claim ${claimId} (${claim.claimedQty} unit(s))`,
        },
        tx,
      );

      const updated = await tx.procurementDamageClaim.findUnique({
        where: { id: claimId },
        include: { images: true },
      });
      return {
        claim: updated,
        finalPayableAmount: totals.finalPayableAmount.toString(),
      };
    });
  }

  /**
   * Admin REJECTS a damage claim: the claim is denied, so the units are NOT
   * damaged — they become saleable (added to onHandQty) and the franchise still
   * pays for them (approvedDamagedQty unchanged → full received billed).
   */
  async rejectDamageClaim(adminId: string, claimId: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.procurementDamageClaim.findUnique({
        where: { id: claimId },
        include: { request: true },
      });
      if (!claim) throw new NotFoundAppException('Damage claim not found');
      if (claim.status !== 'PENDING') {
        throw new BadRequestAppException(
          `Damage claim is already ${claim.status.toLowerCase()}.`,
        );
      }
      const franchiseId = claim.request.franchiseId;

      // Denied → the units were never written off, so add them as saleable now.
      await this.inventoryService.addProcurementStock(
        franchiseId,
        claim.productId,
        claim.variantId,
        claim.globalSku,
        claim.claimedQty,
        claim.procurementRequestId,
        adminId,
        undefined,
        'ADMIN',
        tx,
      );

      await tx.procurementDamageClaim.update({
        where: { id: claimId },
        data: {
          status: 'REJECTED',
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        },
      });

      // approvedDamagedQty unchanged → payable already reflects full received.
      const totals = await this.procurementRepo.calculateTotals(
        claim.procurementRequestId,
        tx,
      );
      await tx.procurementRequest.update({
        where: { id: claim.procurementRequestId },
        data: {
          totalApprovedAmount: totals.totalApprovedAmount,
          procurementFeeAmount: totals.procurementFeeAmount,
          finalPayableAmount: totals.finalPayableAmount,
        },
      });

      await this.recordProcurementEvent(
        {
          procurementRequestId: claim.procurementRequestId,
          action: 'DAMAGE_CLAIM_REJECTED',
          fromStatus: claim.request.status,
          toStatus: claim.request.status,
          actorId: adminId,
          actorType: 'ADMIN',
          reason: `Rejected damage claim ${claimId} (${claim.claimedQty} unit(s) returned to saleable)`,
        },
        tx,
      );

      const updated = await tx.procurementDamageClaim.findUnique({
        where: { id: claimId },
        include: { images: true },
      });
      return {
        claim: updated,
        finalPayableAmount: totals.finalPayableAmount.toString(),
      };
    });
  }
}
