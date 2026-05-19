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
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
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
      // Validate catalog mapping exists
      const mapping = await this.catalogRepo.findByFranchiseAndProduct(
        franchiseId,
        item.productId,
        item.variantId ?? null,
      );
      if (!mapping) {
        throw new BadRequestAppException(
          `Product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''} is not mapped in your catalog`,
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

    // 5. Create sale record
    const sale = await this.posRepo.createSale({
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
      createdByStaffId: actorId,
      items: enrichedItems,
    });

    // 6. Deduct stock for each item
    for (const item of enrichedItems) {
      await this.inventoryService.deductPosStock(
        franchiseId,
        item.productId,
        item.variantId ?? null,
        item.quantity,
        sale.id,
        actorId,
      );
    }

    // 7. Record POS commission in the franchise finance ledger so this sale
    //    rolls into the next settlement cycle. Uses the franchise's online
    //    fulfillment rate as the POS rate. Best-effort: stock has already
    //    been deducted and the sale persisted, so a ledger failure here is
    //    logged but must not roll back the sale.
    try {
      const commissionRate = Number(franchise.onlineFulfillmentRate);
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
  ) {
    // 1. Find sale and validate
    const sale = await this.posRepo.findByIdWithItems(saleId);
    if (!sale) {
      throw new NotFoundAppException('POS sale not found');
    }
    if (sale.franchiseId !== franchiseId) {
      throw new NotFoundAppException('POS sale not found');
    }
    if (sale.status !== 'COMPLETED') {
      throw new BadRequestAppException(
        `Cannot void a sale with status ${sale.status}. Only COMPLETED sales can be voided.`,
      );
    }

    // High-value void monitoring (full approval workflow is Sprint 5+)
    const VOID_APPROVAL_THRESHOLD = 10000; // ₹10,000
    if (Number(sale.netAmount) > VOID_APPROVAL_THRESHOLD) {
      this.logger.warn(
        `High-value POS void: sale ${saleId}, amount ₹${sale.netAmount}, by ${actorId} — threshold ₹${VOID_APPROVAL_THRESHOLD}`,
      );
    }

    // 2. Atomic state transition — only proceed if the row is still
    //    COMPLETED. Pre-Phase-7 the check above was decoupled from the
    //    updateSale below, so two concurrent retries could both pass
    //    the check and both fire the inventory reversal in step 3,
    //    refunding stock twice. The CAS claim closes that race: only
    //    the first request observes count=1 and continues; the loser
    //    sees count=0 and short-circuits. Idempotent at the operation
    //    level — a retried successful request now returns the
    //    already-VOIDED row without any side effects.
    const voidedAt = new Date();
    const claimed = await this.posRepo.claimSaleTransition(
      saleId,
      'COMPLETED',
      {
        status: 'VOIDED',
        voidedAt,
        voidReason: reason,
      },
    );
    if (claimed === 0) {
      // Another writer beat us to it. Refetch and return the current
      // state so retried clients see the same response as the winner.
      const current = await this.posRepo.findByIdWithItems(saleId);
      this.logger.log(
        `POS void for sale ${sale.saleNumber} was a duplicate — returning current state without side effects`,
      );
      return current;
    }

    // 3. Return stock for each item — only reachable when we won the
    //    claim, so concurrent retries cannot double-refund inventory.
    for (const item of sale.items) {
      await this.inventoryService.returnPosStock(
        franchiseId,
        item.productId,
        item.variantId ?? null,
        item.quantity,
        saleId,
        actorId,
      );
    }

    // Re-fetch the updated row for the response — `claimSaleTransition`
    // returns a count, not the row.
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
    items: Array<{ itemId: string; returnQty: number }>,
    actorId: string,
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

    // 2. Validate and process each return item, tracking refund amount
    let refundAmount = 0;
    for (const returnItem of items) {
      const saleItem = saleItemMap.get(returnItem.itemId);
      if (!saleItem) {
        throw new BadRequestAppException(
          `Sale item ${returnItem.itemId} not found in this sale`,
        );
      }
      if (returnItem.returnQty > saleItem.quantity) {
        throw new BadRequestAppException(
          `Return quantity (${returnItem.returnQty}) exceeds original quantity (${saleItem.quantity}) for item ${saleItem.productTitle}`,
        );
      }

      // Pro-rata refund for this line: line's net contribution per unit × qty
      const unitNet =
        Number(saleItem.lineTotal) / Math.max(saleItem.quantity, 1);
      refundAmount += unitNet * returnItem.returnQty;

      // Return stock
      await this.inventoryService.returnPosStock(
        franchiseId,
        saleItem.productId,
        saleItem.variantId ?? null,
        returnItem.returnQty,
        saleId,
        actorId,
      );
    }

    // 3. Determine new status
    // Check if ALL items are fully returned
    const returnMap = new Map<string, number>();
    for (const ri of items) {
      returnMap.set(ri.itemId, ri.returnQty);
    }

    const allFullyReturned = sale.items.every((si: any) => {
      const returnQty = returnMap.get(si.id) ?? 0;
      return returnQty >= si.quantity;
    });

    const newStatus = allFullyReturned ? 'RETURNED' : 'PARTIALLY_RETURNED';

    // 4. Update sale status
    const updated = await this.posRepo.updateSale(saleId, {
      status: newStatus,
    });

    // 5. Record a paired POS_SALE_REVERSAL ledger entry for the refunded
    //    portion. Uses the franchise's current online rate; the original
    //    sale's rate isn't stored, so very old sales will reverse at today's
    //    rate — acceptable given same-cycle settlement.
    try {
      const franchise = await this.partnerRepo.findById(franchiseId);
      const commissionRate = Number(franchise?.onlineFulfillmentRate ?? 0);
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

  async getDailyReport(franchiseId: string, date: Date) {
    return this.posRepo.getDailyReport(franchiseId, date);
  }

  // ── Daily reconciliation ────────────────────────────────────

  async getDailyReconciliation(franchiseId: string, date: Date) {
    const report = await this.posRepo.getDailyReport(franchiseId, date);

    // Get inventory movements for the day (POS_SALE + POS_RETURN)
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const movements = await this.prisma.franchiseInventoryLedger.findMany({
      where: {
        franchiseId,
        movementType: { in: ['POS_SALE', 'POS_RETURN'] },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: { movementType: true, quantityDelta: true },
    });

    const totalItemsSold = movements
      .filter((m) => m.movementType === 'POS_SALE')
      .reduce((sum, m) => sum + Math.abs(m.quantityDelta), 0);
    const totalItemsReturned = movements
      .filter((m) => m.movementType === 'POS_RETURN')
      .reduce((sum, m) => sum + m.quantityDelta, 0);

    return {
      ...report,
      inventoryReconciliation: {
        totalItemsSold,
        totalItemsReturned,
        netItemsMovement: totalItemsSold - totalItemsReturned,
      },
      closureStatus: 'GENERATED',
      generatedAt: new Date().toISOString(),
    };
  }
}
