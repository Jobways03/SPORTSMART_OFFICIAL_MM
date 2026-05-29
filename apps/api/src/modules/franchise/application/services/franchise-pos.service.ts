import { Injectable, Inject } from '@nestjs/common';
import {
  FranchisePosRepository,
  FRANCHISE_POS_REPOSITORY,
} from '../../domain/repositories/franchise-pos.repository.interface';
import {
  FranchiseCatalogRepository,
  FRANCHISE_CATALOG_REPOSITORY,
} from '../../domain/repositories/franchise-catalog.repository.interface';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { FranchiseInventoryService } from './franchise-inventory.service';
import { FranchiseCommissionService } from './franchise-commission.service';
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
import { toCsv } from '../../../../core/utils/csv.util';
import { calculateLineTax } from '../../../tax/domain/tax-engine';
import { TaxPublicFacade } from '../../../tax/application/facades/tax-public.facade';

@Injectable()
export class FranchisePosService {
  constructor(
    @Inject(FRANCHISE_POS_REPOSITORY)
    private readonly posRepo: FranchisePosRepository,
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly partnerRepo: FranchisePartnerRepository,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly commissionService: FranchiseCommissionService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
    private readonly taxFacade: TaxPublicFacade,
    private readonly env: EnvService,
  ) {
    this.logger.setContext('FranchisePosService');
  }

  // ── Record a new POS sale ────────────────────────────────────

  async recordSale(
    franchiseId: string,
    input: {
      saleType?: string;
      customerName?: string;
      customerPhone?: string;
      paymentMethod?: string;
      items: Array<{
        productId: string;
        variantId?: string;
        quantity: number;
        unitPrice: number;
        lineDiscount?: number;
      }>;
    },
    actorId: string,
    // Phase 159q (audit #5) — the staff member's id (null today; populated when
    // a per-cashier staff JWT lands). Written to createdByStaffId so it is
    // either a real FranchiseStaff id or NULL — never the franchise's own id.
    staffId?: string | null,
  ) {
    // 1. Validate franchise is ACTIVE
    const franchise = await this.partnerRepo.findById(franchiseId);
    if (!franchise) {
      throw new NotFoundAppException('Franchise not found');
    }
    if (franchise.status !== 'ACTIVE') {
      throw new ForbiddenAppException(
        'Only ACTIVE franchises can record POS sales',
      );
    }
    if (franchise.contractEndDate && new Date() > new Date(franchise.contractEndDate)) {
      throw new ForbiddenAppException(
        'Franchise contract has expired — cannot record sales',
      );
    }

    // Note: soldAt defaults to now() in the schema and is not exposed in the
    // POS DTO, so backdating is not possible through the current API. Prisma
    // uses the schema default when soldAt is omitted from the create payload.

    if (!input.items || input.items.length === 0) {
      throw new BadRequestAppException('At least one item is required');
    }

    // Phase 4 / H45 — server-side guards. The POS frontend now clamps
    // these values client-side but a non-browser caller (curl, an
    // out-of-date build, a buggy barcode-scanner integration) can
    // still send a negative unitPrice or a discount that exceeds the
    // line gross. Refuse with a specific error rather than letting
    // it through to net-negative totals.
    for (const it of input.items) {
      if (it.quantity == null || it.quantity < 1) {
        throw new BadRequestAppException(
          `Item ${it.productId}: quantity must be at least 1 (got ${it.quantity})`,
        );
      }
      if (!Number.isInteger(it.quantity)) {
        throw new BadRequestAppException(
          `Item ${it.productId}: quantity must be a whole number (got ${it.quantity})`,
        );
      }
      if (it.unitPrice == null || it.unitPrice < 0) {
        throw new BadRequestAppException(
          `Item ${it.productId}: unitPrice cannot be negative (got ${it.unitPrice})`,
        );
      }
      const discount = it.lineDiscount ?? 0;
      if (discount < 0) {
        throw new BadRequestAppException(
          `Item ${it.productId}: lineDiscount cannot be negative (got ${discount})`,
        );
      }
      const lineGross = it.unitPrice * it.quantity;
      if (discount > lineGross) {
        throw new BadRequestAppException(
          `Item ${it.productId}: lineDiscount ${discount} exceeds line gross ${lineGross.toFixed(2)} (would make net negative)`,
        );
      }
    }

    // 2. Validate each item and build enriched items list
    const enrichedItems: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      productTitle: string;
      variantTitle?: string;
      quantity: number;
      unitPrice: number;
      lineDiscount: number;
      lineTotal: number;
      // Phase 26 GST — per-item tax snapshot. Computed from the
      // catalog HSN + rate using the same tax-engine the marketplace
      // checkout uses. Pricing mode is INCLUSIVE (POS quotes retail
      // prices that already include GST). All POS sales are intra-state
      // today (walk-in customer at franchise location) so CGST+SGST
      // always, IGST always 0. Numbers carried as integer paise.
      hsnCode: string | null;
      gstRateBps: number;
      taxableAmount: number;
      cgstAmount: number;
      sgstAmount: number;
      igstAmount: number;
    }> = [];

    for (const item of input.items) {
      // Phase 159n (audit #1) — require an APPROVED + active mapping. A
      // self-created PENDING / REJECTED / STOPPED mapping must NOT be sellable
      // (previously this used the unfiltered lookup, so a franchise could sell
      // a SKU the admin had not yet vetted).
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

      // Resolve product/variant titles + HSN + GST rate. Variant overrides
      // win when present (a single-variant override pattern matches the
      // marketplace checkout's tax-snapshot resolution).
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        select: { title: true, hsnCode: true, gstRateBps: true },
      });
      let variantTitle: string | undefined;
      let hsnOverride: string | null = null;
      let gstRateBpsOverride: number | null = null;
      if (item.variantId) {
        const variant = await this.prisma.productVariant.findUnique({
          where: { id: item.variantId },
          select: { title: true, hsnCodeOverride: true, gstRateBpsOverride: true },
        });
        variantTitle = variant?.title ?? undefined;
        hsnOverride = variant?.hsnCodeOverride ?? null;
        gstRateBpsOverride = variant?.gstRateBpsOverride ?? null;
      }
      const hsnCode = hsnOverride ?? product?.hsnCode ?? null;
      const gstRateBps = gstRateBpsOverride ?? product?.gstRateBps ?? 0;

      // Check available stock
      const stock = await this.inventoryService.getStockDetail(
        franchiseId,
        item.productId,
        item.variantId,
      );
      if (!stock || stock.availableQty < item.quantity) {
        const available = stock?.availableQty ?? 0;
        throw new BadRequestAppException(
          `Insufficient stock for ${product?.title ?? item.productId}: available=${available}, requested=${item.quantity}`,
        );
      }

      const lineDiscount = item.lineDiscount ?? 0;
      const lineTotal = item.unitPrice * item.quantity - lineDiscount;

      // Tax computation. The engine works in paise (BigInt) so we
      // convert rupees → paise on the way in and back on the way out.
      // POS pricing is INCLUSIVE (retail price already includes GST);
      // intra-state (CGST+SGST) for every POS sale today.
      const tax = calculateLineTax({
        grossInPaise: BigInt(Math.round(item.unitPrice * item.quantity * 100)),
        discountInPaise: BigInt(Math.round(lineDiscount * 100)),
        gstRateBps,
        priceIncludesTax: true,
        isIntraState: true,
        supplyTaxability: 'TAXABLE',
      });

      enrichedItems.push({
        productId: item.productId,
        variantId: item.variantId,
        globalSku: mapping.globalSku,
        franchiseSku: mapping.franchiseSku ?? undefined,
        productTitle: product?.title ?? 'Unknown Product',
        variantTitle,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineDiscount,
        lineTotal,
        hsnCode,
        gstRateBps,
        taxableAmount: Number(tax.taxableInPaise) / 100,
        cgstAmount: Number(tax.cgstInPaise) / 100,
        sgstAmount: Number(tax.sgstInPaise) / 100,
        igstAmount: Number(tax.igstInPaise) / 100,
      });
    }

    // 3. Calculate totals (including sale-level tax rollup).
    let grossAmount = 0;
    let discountAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    for (const item of enrichedItems) {
      grossAmount += item.unitPrice * item.quantity;
      discountAmount += item.lineDiscount;
      cgstAmount += item.cgstAmount;
      sgstAmount += item.sgstAmount;
      igstAmount += item.igstAmount;
    }
    const taxAmount = cgstAmount + sgstAmount + igstAmount;
    // Retail prices are inclusive of tax — net = gross − discount.
    // (Tax is *carved out* of the net for reporting, not added on top.)
    const netAmount = grossAmount - discountAmount;

    // 4. Generate sale number
    const saleNumber = await this.posRepo.generateNextSaleNumber(
      franchise.franchiseCode,
    );

    // Phase 159q (audit #13) — snapshot the commission rate ON the sale so a
    // cross-cycle return reverses at the rate in force when sold, not today's.
    const commissionRate = Number(franchise.onlineFulfillmentRate);

    // Phase 159q (audit #2 + #3) — the sale row, all items, and every stock
    // deduction commit in ONE transaction. Previously the sale was created
    // then each deduct ran in its own transaction, so a mid-loop failure left
    // the sale persisted with items the inventory ledger never decremented
    // (sales/inventory drift) and a retry double-deducted. Because
    // deductPosStock takes the FOR-UPDATE row lock (Phase 159o), a concurrent
    // oversell now also rolls the whole sale back instead of orphaning it.
    const sale = await this.prisma.$transaction(async (tx) => {
      const created = await this.posRepo.createSale(
        {
          saleNumber,
          franchiseId,
          saleType: input.saleType ?? 'WALK_IN',
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          grossAmount,
          discountAmount,
          taxAmount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          placeOfSupplyState: franchise.state ?? null,
          netAmount,
          paymentMethod: input.paymentMethod ?? 'CASH',
          // Phase 159q (audit #5) — staff id (nullable), NOT the franchise id.
          createdByStaffId: staffId ?? null,
          commissionRate,
          items: enrichedItems,
        },
        tx,
      );

      for (const item of enrichedItems) {
        await this.inventoryService.deductPosStock(
          franchiseId,
          item.productId,
          item.variantId ?? null,
          item.quantity,
          created.id,
          actorId,
          tx,
        );
      }
      return created;
    });

    // 7. Record POS commission in the franchise finance ledger so this sale
    //    rolls into the next settlement cycle. Best-effort + post-commit: the
    //    sale + stock are already durable, so a ledger failure here is logged
    //    but must not roll back the sale.
    try {
      await this.commissionService.recordPosCommission({
        franchiseId,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        netAmount,
        commissionRate,
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to record POS commission for sale ${sale.saleNumber}: ${err?.message ?? err}`,
      );
    }

    // 8. Publish event
    await this.eventBus.publish({
      eventName: 'franchise.pos.sale_completed',
      aggregate: 'FranchisePosSale',
      aggregateId: sale.id,
      occurredAt: new Date(),
      payload: {
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        franchiseId,
        netAmount,
        // Phase 3 / C8 — emit the tax rollup on the event so a
        // downstream invoice-generator handler (when wired) can
        // build the tax_document row without re-querying.
        cgstAmount,
        sgstAmount,
        igstAmount,
        taxableAmount: netAmount - (cgstAmount + sgstAmount + igstAmount),
        itemCount: enrichedItems.length,
        actorId,
      },
    });

    // Follow-up #133 — issue the §31 tax invoice for the POS sale. The
    // facade is best-effort and never throws, so a wedged tax-document
    // service can't roll back the sale; a missing invoice surfaces
    // via the gap-audit cron + the PDF-pending retry processor (Phase
    // 19). Finance gates GSTR-1 filing on the presence of these rows.
    const invoice = await this.taxFacade.generateInvoiceForPosSale(sale.id);
    // Phase 159q (audit #10) — record the outcome on the sale row so a missing
    // invoice is queryable (taxInvoiceStatus=FAILED) instead of log-only.
    // Best-effort: a write failure here doesn't roll back the durable sale.
    try {
      await this.posRepo.updateSale(sale.id, {
        taxInvoiceStatus: invoice ? 'ISSUED' : 'FAILED',
        taxInvoiceId: (invoice as any)?.id ?? null,
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to stamp taxInvoiceStatus on POS sale ${saleNumber}: ${err?.message ?? err}`,
      );
    }
    if (invoice) {
      this.logger.log(
        `POS sale ${saleNumber} issued ${invoice.documentNumber} (isNew=${invoice.isNew})`,
      );
    } else {
      this.logger.warn(
        `POS sale ${saleNumber} recorded but tax invoice generation failed — gap-audit cron will surface for retry`,
      );
    }

    this.logger.log(
      `POS sale ${saleNumber} recorded for franchise ${franchise.franchiseCode} — net=${netAmount}`,
    );

    return sale;
  }

  // ── Void a sale ──────────────────────────────────────────────

  async voidSale(
    franchiseId: string,
    saleId: string,
    reason: string,
    actorId: string,
    // Phase 159r (audit #10) — staff id for voidedBy (null today; staff JWT TBD).
    staffId?: string | null,
  ) {
    // 1. Find sale and validate
    const sale = await this.posRepo.findByIdWithItems(saleId);
    if (!sale) {
      throw new NotFoundAppException('POS sale not found');
    }
    if (sale.franchiseId !== franchiseId) {
      throw new NotFoundAppException('POS sale not found');
    }
    // Phase 159r (audit #16) — allow voiding a partially-returned sale too; the
    // already-returned units are not restocked again (only the remainder is).
    if (sale.status !== 'COMPLETED' && sale.status !== 'PARTIALLY_RETURNED') {
      throw new BadRequestAppException(
        `Cannot void a sale with status ${sale.status}. Only COMPLETED or PARTIALLY_RETURNED sales can be voided.`,
      );
    }

    // Phase 159r (audit #9) — void window. A franchise may only self-void
    // within POS_VOID_WINDOW_HOURS of the sale; older voids need an admin path
    // (not yet built). 0 disables the window.
    const windowHours = this.env.getNumber('POS_VOID_WINDOW_HOURS', 24);
    if (windowHours > 0) {
      const ageMs = Date.now() - new Date(sale.soldAt).getTime();
      if (ageMs > windowHours * 60 * 60 * 1000) {
        throw new BadRequestAppException(
          `This sale is older than the ${windowHours}h void window and cannot be voided at the POS. Contact admin support.`,
        );
      }
    }

    // High-value void monitoring (full approval workflow is Sprint 5+)
    const VOID_APPROVAL_THRESHOLD = 10000; // ₹10,000
    if (Number(sale.netAmount) > VOID_APPROVAL_THRESHOLD) {
      this.logger.warn(
        `High-value POS void: sale ${saleId}, amount ₹${sale.netAmount}, by ${actorId} — threshold ₹${VOID_APPROVAL_THRESHOLD}`,
      );
    }

    // 2. Phase 159r (audit #3-sibling) — CAS + stock restore in ONE transaction
    //    (was CAS then a loop outside any tx, so a mid-loop failure left a
    //    VOIDED sale with stock only partially restored). The CAS claims the
    //    transition from the observed status; the loser sees count=0 and we
    //    return the current row idempotently.
    const voidedAt = new Date();
    const observedStatus = sale.status;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const count = await this.posRepo.claimSaleTransition(
        saleId,
        observedStatus,
        {
          status: 'VOIDED',
          voidedAt,
          voidReason: reason,
          voidedBy: staffId ?? null,
        },
        tx,
      );
      if (count === 0) return 0;

      // Phase 159r (audit #16) — restore only the NON-returned units; a
      // partially-returned sale already restocked the returned ones. (audit #8)
      // — route through the POS_VOID movement type, not POS_RETURN.
      for (const item of sale.items) {
        const restoreQty = item.quantity - (item.returnedQty ?? 0);
        if (restoreQty <= 0) continue;
        await this.inventoryService.returnPosStock(
          franchiseId,
          item.productId,
          item.variantId ?? null,
          restoreQty,
          saleId,
          actorId,
          tx,
          { movementType: 'POS_VOID' },
        );
      }
      return count;
    });
    if (claimed === 0) {
      // Another writer beat us to it. Refetch and return the current state so
      // retried clients see the same response as the winner.
      const current = await this.posRepo.findByIdWithItems(saleId);
      this.logger.log(
        `POS void for sale ${sale.saleNumber} was a duplicate — returning current state without side effects`,
      );
      return current;
    }

    // Re-fetch the updated row for the response.
    const updated = await this.posRepo.findByIdWithItems(saleId);

    // 4. Void the matching commission ledger entry so it does not settle.
    try {
      await this.commissionService.recordPosVoid({ franchiseId, saleId });
    } catch (err: any) {
      this.logger.error(
        `Failed to void POS commission for sale ${sale.saleNumber}: ${err?.message ?? err}`,
      );
    }

    // 5. Publish event
    await this.eventBus.publish({
      eventName: 'franchise.pos.sale_voided',
      aggregate: 'FranchisePosSale',
      aggregateId: saleId,
      occurredAt: new Date(),
      payload: {
        saleId,
        saleNumber: sale.saleNumber,
        franchiseId,
        reason,
        actorId,
      },
    });

    this.logger.log(
      `POS sale ${sale.saleNumber} voided — reason: ${reason}`,
    );

    return updated;
  }

  // ── Return items from a sale ─────────────────────────────────

  async returnSale(
    franchiseId: string,
    saleId: string,
    items: Array<{ itemId: string; returnQty: number; condition?: 'SALEABLE' | 'DAMAGED' }>,
    actorId: string,
    opts?: {
      refundMethod?: string;
      returnReason?: string | null;
      refundReference?: string | null;
      staffId?: string | null;
    },
  ) {
    // 1. Find sale with items and validate
    const sale = await this.posRepo.findByIdWithItems(saleId);
    if (!sale) {
      throw new NotFoundAppException('POS sale not found');
    }
    if (sale.franchiseId !== franchiseId) {
      throw new NotFoundAppException('POS sale not found');
    }
    if (sale.status !== 'COMPLETED' && sale.status !== 'PARTIALLY_RETURNED') {
      throw new BadRequestAppException(
        `Cannot return items from a sale with status ${sale.status}. Only COMPLETED or PARTIALLY_RETURNED sales can accept returns.`,
      );
    }

    if (!items || items.length === 0) {
      throw new BadRequestAppException(
        'At least one return item is required',
      );
    }

    // Build a map of sale items for quick lookup
    const saleItemMap = new Map<string, any>();
    for (const si of sale.items) {
      saleItemMap.set(si.id, si);
    }

    // 2. Validate each return line + compute the refund. NO stock mutation
    //    here — that happens inside the transaction below, only after the CAS
    //    claim succeeds, so a concurrent return can't restock twice.
    let refundAmount = 0;
    for (const returnItem of items) {
      const saleItem = saleItemMap.get(returnItem.itemId);
      if (!saleItem) {
        throw new BadRequestAppException(
          `Sale item ${returnItem.itemId} not found in this sale`,
        );
      }
      // Phase 159r (audit #1) — CUMULATIVE over-return guard. Check against the
      // remaining returnable quantity (original − already-returned), not the
      // original alone, so 3+3 against a 5-unit line is rejected on the second
      // round. (DTO enforces returnQty ≥ 1, so the divide below is safe.)
      const alreadyReturned = saleItem.returnedQty ?? 0;
      const remaining = saleItem.quantity - alreadyReturned;
      if (returnItem.returnQty > remaining) {
        throw new BadRequestAppException(
          `Return quantity (${returnItem.returnQty}) exceeds remaining returnable (${remaining}) for item ${saleItem.productTitle} — ${alreadyReturned} of ${saleItem.quantity} already returned`,
        );
      }
      const unitNet = Number(saleItem.lineTotal) / saleItem.quantity;
      refundAmount += unitNet * returnItem.returnQty;
    }
    const roundedRefund = Math.round(refundAmount * 100) / 100;

    // 3. Determine new status from CUMULATIVE returned qty across all items
    //    (prior rounds + this one), not just the items in this request.
    const returnMap = new Map<string, number>();
    for (const ri of items) {
      returnMap.set(ri.itemId, ri.returnQty);
    }
    const allFullyReturned = sale.items.every((si: any) => {
      const thisReturn = returnMap.get(si.id) ?? 0;
      return (si.returnedQty ?? 0) + thisReturn >= si.quantity;
    });
    const newStatus = allFullyReturned ? 'RETURNED' : 'PARTIALLY_RETURNED';
    const refundMethod = (opts?.refundMethod ?? 'CASH') as any;
    const returnedBy = opts?.staffId ?? null;

    // 4. Phase 159q (audit #14) — CAS + atomic stock return, mirroring voidSale.
    //    Phase 159r — also: increment per-item returnedQty (#1), route DAMAGED
    //    units to damagedQty (#7), persist a first-class FranchisePosReturn
    //    record (#6/#12), bump the sale's refundedAmount + returnedAt/By
    //    (#10/#11) — all in the SAME transaction.
    const observedStatus = sale.status;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await this.posRepo.claimSaleTransition(
        saleId,
        observedStatus,
        {
          status: newStatus,
          returnedAt: new Date(),
          returnedBy,
          returnReason: opts?.returnReason ?? null,
          refundedAmount: { increment: roundedRefund },
        },
        tx,
      );
      if (claimed === 0) {
        throw new ConflictAppException(
          'This sale was modified concurrently (another return or void). Refresh and retry.',
        );
      }

      for (const returnItem of items) {
        const saleItem = saleItemMap.get(returnItem.itemId);
        const toDamaged = returnItem.condition === 'DAMAGED';
        await this.inventoryService.returnPosStock(
          franchiseId,
          saleItem.productId,
          saleItem.variantId ?? null,
          returnItem.returnQty,
          saleId,
          actorId,
          tx,
          { movementType: 'POS_RETURN', toDamaged },
        );
        // #1 — bump the cumulative returned counter under the same tx.
        await tx.franchisePosSaleItem.update({
          where: { id: returnItem.itemId },
          data: { returnedQty: { increment: returnItem.returnQty } },
        });
      }

      // #6/#12 — first-class return record. returnNumber = <saleNumber>-R<n>.
      const priorCount = await tx.franchisePosReturn.count({ where: { saleId } });
      await tx.franchisePosReturn.create({
        data: {
          returnNumber: `${sale.saleNumber}-R${priorCount + 1}`,
          saleId,
          franchiseId,
          refundAmount: roundedRefund,
          refundMethod,
          refundReference: opts?.refundReference ?? null,
          returnReason: opts?.returnReason ?? null,
          returnedBy,
          items: {
            create: items.map((ri) => ({
              saleItemId: ri.itemId,
              returnQty: ri.returnQty,
              condition: (ri.condition ?? 'SALEABLE') as any,
            })),
          },
        },
      });
    });
    const updated = await this.posRepo.findByIdWithItems(saleId);

    // 5. Record a paired POS_SALE_REVERSAL ledger entry for the refunded
    //    portion. Phase 159q (audit #13) — reverse at the rate SNAPSHOTTED on
    //    the sale (commissionRate), falling back to the franchise's current
    //    rate only for legacy sales recorded before the snapshot column existed.
    try {
      const franchise = await this.partnerRepo.findById(franchiseId);
      const commissionRate =
        sale.commissionRate != null
          ? Number(sale.commissionRate)
          : Number(franchise?.onlineFulfillmentRate ?? 0);
      if (refundAmount > 0 && commissionRate > 0) {
        await this.commissionService.recordPosReturn({
          franchiseId,
          saleId,
          saleNumber: sale.saleNumber,
          refundAmount: Math.round(refundAmount * 100) / 100,
          commissionRate,
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to record POS return reversal for sale ${sale.saleNumber}: ${err?.message ?? err}`,
      );
    }

    // 6. Publish event
    await this.eventBus.publish({
      eventName: 'franchise.pos.sale_returned',
      aggregate: 'FranchisePosSale',
      aggregateId: saleId,
      occurredAt: new Date(),
      payload: {
        saleId,
        saleNumber: sale.saleNumber,
        franchiseId,
        returnedItems: items,
        newStatus,
        actorId,
      },
    });

    this.logger.log(
      `POS sale ${sale.saleNumber} ${newStatus === 'RETURNED' ? 'fully returned' : 'partially returned'}`,
    );

    return updated;
  }

  // ── List sales ───────────────────────────────────────────────

  async listSales(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      status?: string;
      saleType?: string;
      fromDate?: Date;
      toDate?: Date;
      search?: string;
    },
  ) {
    return this.posRepo.findByFranchiseId(franchiseId, params);
  }

  // ── Get sale detail ──────────────────────────────────────────

  async getSaleDetail(franchiseId: string, saleId: string) {
    const sale = await this.posRepo.findByIdWithItems(saleId);
    if (!sale) {
      throw new NotFoundAppException('POS sale not found');
    }
    if (sale.franchiseId !== franchiseId) {
      throw new NotFoundAppException('POS sale not found');
    }

    return sale;
  }

  // ── Daily report ─────────────────────────────────────────────

  /**
   * Phase 159s (POS report audit #4) — resolve a calendar date (YYYY-MM-DD) in
   * the franchise's report timezone (IST by default) to an absolute UTC window,
   * so a UTC-deployed pod doesn't bleed a 00:15-IST sale into the prior day.
   * India has no DST, so a fixed offset is correct. Future dates are rejected.
   */
  private posDayRangeUtc(dateStr: string): { gte: Date; lte: Date } {
    const offsetMin = this.env.getNumber('FRANCHISE_REPORT_TZ_OFFSET_MINUTES', 330);
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    const gte = new Date(`${dateStr}T00:00:00.000${off}`);
    const lte = new Date(`${dateStr}T23:59:59.999${off}`);
    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime())) {
      throw new BadRequestAppException(`Invalid report date: ${dateStr}`);
    }
    if (gte.getTime() > Date.now()) {
      throw new BadRequestAppException('Report date cannot be in the future');
    }
    return { gte, lte };
  }

  /** Today's calendar date (YYYY-MM-DD) in the report timezone. */
  todayInReportTz(): string {
    const offsetMin = this.env.getNumber('FRANCHISE_REPORT_TZ_OFFSET_MINUTES', 330);
    return new Date(Date.now() + offsetMin * 60_000).toISOString().slice(0, 10);
  }

  async getDailyReport(franchiseId: string, dateStr: string) {
    return this.posRepo.getDailyReport(franchiseId, this.posDayRangeUtc(dateStr));
  }

  /**
   * Phase 159s (POS report audit #7) — finance-grade CSV of the daily report.
   * Built via the shared `toCsv` helper, which RFC-4180-quotes every cell and
   * neutralises CSV/formula-injection (leading = + - @) — so a malicious
   * product title etc. can't execute when finance opens the file in Excel.
   */
  async getDailyReportCsv(franchiseId: string, dateStr: string): Promise<string> {
    const r = await this.posRepo.getDailyReport(franchiseId, this.posDayRangeUtc(dateStr));
    const rows: Array<Record<string, unknown>> = [
      { metric: 'Date', value: dateStr },
      { metric: 'Total Sales (count)', value: r.totalSales },
      { metric: 'Gross Amount', value: r.totalGrossAmount },
      { metric: 'Discount', value: r.totalDiscountAmount },
      { metric: 'Net Revenue (after refunds)', value: r.totalNetAmount },
      { metric: 'Refund Total', value: r.refundTotal },
      { metric: 'Voided Count', value: r.voidedSales.count },
      { metric: 'Voided Amount', value: r.voidedSales.amount },
      { metric: 'Returned Count', value: r.returnedSales.count },
      { metric: 'CGST', value: r.tax.cgst },
      { metric: 'SGST', value: r.tax.sgst },
      { metric: 'IGST', value: r.tax.igst },
      { metric: 'Tax Total', value: r.tax.total },
    ];
    for (const [method, v] of Object.entries(r.salesByPaymentMethod)) {
      rows.push({ metric: `Payment ${method} (count)`, value: v.count });
      rows.push({ metric: `Payment ${method} (amount)`, value: v.amount });
    }
    for (const [type, v] of Object.entries(r.salesByType)) {
      rows.push({ metric: `Type ${type} (count)`, value: v.count });
      rows.push({ metric: `Type ${type} (amount)`, value: v.amount });
    }
    return toCsv(rows, ['metric', 'value'], { bom: true });
  }

  // ── Daily reconciliation ────────────────────────────────────

  async getDailyReconciliation(franchiseId: string, dateStr: string) {
    const range = this.posDayRangeUtc(dateStr);
    const report = await this.posRepo.getDailyReport(franchiseId, range);

    // Inventory movements for the day. Phase 159r split voids onto POS_VOID, so
    // POS_RETURN now means genuine customer returns only (audit #8 — voids no
    // longer double-count as returns); POS_VOID is reported separately.
    const movements = await this.prisma.franchiseInventoryLedger.findMany({
      where: {
        franchiseId,
        movementType: { in: ['POS_SALE', 'POS_RETURN', 'POS_VOID'] },
        createdAt: { gte: range.gte, lte: range.lte },
      },
      select: { movementType: true, quantityDelta: true },
    });

    const sumAbs = (type: string) =>
      movements
        .filter((m) => m.movementType === type)
        .reduce((sum, m) => sum + Math.abs(m.quantityDelta), 0);
    const totalItemsSold = sumAbs('POS_SALE');
    const totalItemsReturned = sumAbs('POS_RETURN');
    const totalItemsVoided = sumAbs('POS_VOID');

    return {
      ...report,
      inventoryReconciliation: {
        totalItemsSold,
        totalItemsReturned,
        totalItemsVoided,
        netItemsMovement: totalItemsSold - totalItemsReturned - totalItemsVoided,
      },
      // Phase 159s (audit #12) — honest label. There is no day-closure state
      // machine yet (no frozen snapshot, no sales lock); this is a LIVE
      // recompute. A real FranchisePosDailyClosure is a surfaced follow-up.
      closureStatus: 'OPEN',
      generatedAt: new Date().toISOString(),
    };
  }
}
