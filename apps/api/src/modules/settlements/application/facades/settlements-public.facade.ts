import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class SettlementsPublicFacade {
  private readonly logger = new Logger(SettlementsPublicFacade.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a ledger impact from another module (e.g., commission, return reversal).
   */
  async recordLedgerImpact(ledgerEntry: {
    franchiseId?: string;
    sourceType: string;
    sourceId: string;
    baseAmount: number;
    rate: number;
    computedAmount: number;
    platformEarning: number;
    franchiseEarning: number;
    description?: string;
  }): Promise<void> {
    if (ledgerEntry.franchiseId) {
      await this.prisma.franchiseFinanceLedger.create({
        data: {
          franchiseId: ledgerEntry.franchiseId,
          sourceType: ledgerEntry.sourceType as any,
          sourceId: ledgerEntry.sourceId,
          baseAmount: ledgerEntry.baseAmount,
          rate: ledgerEntry.rate,
          computedAmount: ledgerEntry.computedAmount,
          platformEarning: ledgerEntry.platformEarning,
          franchiseEarning: ledgerEntry.franchiseEarning,
          description: ledgerEntry.description ?? null,
        },
      });
    }

    this.logger.log(
      `Ledger impact recorded: ${ledgerEntry.sourceType} for franchise ${ledgerEntry.franchiseId}`,
    );
  }

  // Phase 142 — the dead per-seller `previewSettlement` was removed. It had
  // zero callers and used different aggregation math than createCycle (per-unit
  // platformPrice×qty vs the snapshotted totals, no settlementId:null filter,
  // createdAt instead of settlableAt, row-count instead of summed quantity) —
  // a dry-run that would have misled operators. The real dry-run is
  // SettlementService.previewCycle, which shares createCycle's aggregator.

  // Phase 144 — the dead `approveSettlementRun` was removed. It did a bare
  // `cycle.update({ status: 'APPROVED' })` with no transaction, no
  // sellerSettlement cascade, no TCS/TDS, no re-validation, no audit, no actor —
  // if ever called it would leave a corrupt state (cycle APPROVED, settlements
  // still PENDING). It had zero callers. Approval goes through
  // SettlementService.approveCycle, the only correct path.

  /**
   * Get a payout statement by ID.
   */
  async getPayoutStatement(statementId: string): Promise<{
    id: string;
    sellerId: string;
    cycleId: string;
    totalOrders: number;
    totalItems: number;
    totalPlatformAmount: number;
    totalPlatformMargin: number;
    status: string;
  } | null> {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: statementId },
    });

    if (!settlement) return null;

    return {
      id: settlement.id,
      sellerId: settlement.sellerId,
      cycleId: settlement.cycleId,
      totalOrders: settlement.totalOrders,
      totalItems: settlement.totalItems,
      totalPlatformAmount: Number(settlement.totalPlatformAmount),
      totalPlatformMargin: Number(settlement.totalPlatformMargin),
      status: settlement.status,
    };
  }

  /**
   * Get commission ledger for a seller.
   */
  async getSellerLedger(sellerId: string): Promise<any[]> {
    const records = await this.prisma.commissionRecord.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return records.map((r) => ({
      id: r.id,
      masterOrderId: r.masterOrderId,
      subOrderId: r.subOrderId,
      platformPrice: Number(r.platformPrice ?? 0),
      settlementPrice: Number(r.settlementPrice ?? 0),
      platformMargin: Number(r.platformMargin ?? 0),
      quantity: r.quantity,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Get finance ledger for a franchise partner.
   */
  async getFranchiseLedger(franchiseId: string): Promise<any[]> {
    const records = await this.prisma.franchiseFinanceLedger.findMany({
      where: { franchiseId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return records.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      baseAmount: Number(r.baseAmount),
      computedAmount: Number(r.computedAmount),
      platformEarning: Number(r.platformEarning),
      franchiseEarning: Number(r.franchiseEarning),
      sourceId: r.sourceId,
      description: r.description,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Get affiliate ledger. (Placeholder until affiliate module is built.)
   */
  async getAffiliateLedger(affiliateId: string): Promise<any[]> {
    this.logger.warn(`Affiliate ledger not yet available for ${affiliateId}`);
    return [];
  }

  /**
   * Phase 28+ — list every SellerSettlement whose cycle.periodEnd lands
   * inside the supplied [startUtc, endUtc) window. Returns the columns
   * the tax module's marketplace GSTR-1 commission aggregator needs,
   * plus an embedded seller-snapshot (gstin, legal name, state code)
   * pulled from the seller record. Keeps the SellerSettlement table
   * + Seller table reads inside the settlements/seller module
   * boundary.
   */
  async listSettlementsForCommissionGstr(
    startUtc: Date,
    endUtc: Date,
  ): Promise<
    Array<{
      sellerId: string;
      totalPlatformMargin: number;
      totalPlatformMarginInPaise: bigint | null;
      cgstOnCommissionInPaise: bigint | null;
      sgstOnCommissionInPaise: bigint | null;
      igstOnCommissionInPaise: bigint | null;
      totalCommissionGstInPaise: bigint | null;
      commissionGstRateBps: number | null;
      commissionGstSplitType: 'CGST_SGST' | 'IGST' | null;
      seller: {
        gstin: string | null;
        legalBusinessName: string | null;
        sellerShopName: string | null;
        gstStateCode: string | null;
      } | null;
    }>
  > {
    const rows = await (this.prisma as any).sellerSettlement.findMany({
      where: { cycle: { periodEnd: { gte: startUtc, lt: endUtc } } },
      include: {
        seller: {
          select: {
            gstin: true,
            legalBusinessName: true,
            sellerShopName: true,
            gstStateCode: true,
          },
        },
      },
    });
    return rows.map((s: any) => ({
      sellerId: s.sellerId,
      totalPlatformMargin: Number(s.totalPlatformMargin ?? 0),
      totalPlatformMarginInPaise: s.totalPlatformMarginInPaise ?? null,
      cgstOnCommissionInPaise: s.cgstOnCommissionInPaise ?? null,
      sgstOnCommissionInPaise: s.sgstOnCommissionInPaise ?? null,
      igstOnCommissionInPaise: s.igstOnCommissionInPaise ?? null,
      totalCommissionGstInPaise: s.totalCommissionGstInPaise ?? null,
      commissionGstRateBps: s.commissionGstRateBps ?? null,
      commissionGstSplitType: s.commissionGstSplitType ?? null,
      seller: s.seller ?? null,
    }));
  }

  /**
   * Phase 159aa (Marketplace Commission GSTR-1 audit B1 + B3 + #10) —
   * filing-period-keyed listing that includes the per-settlement
   * commission-invoice snapshot. The GSTR-1 exporter consumes this to
   * emit one row per invoice (§4 B2B for GSTIN-registered recipients,
   * §7 B2C for unregistered sellers) instead of the pre-Phase-159aa
   * per-(seller, period) rollup.
   *
   * Legacy rows that predate the invoice-issuance hook (no
   * commissionInvoiceFilingPeriod set) are picked up via the
   * cycle.periodEnd ∈ IST month fallback so a historical re-export
   * still surfaces them — they just lack the invoice number column.
   */
  async listCommissionInvoicesForFilingPeriod(args: {
    filingPeriod: string;
    startUtc: Date;
    endUtc: Date;
  }): Promise<
    Array<{
      settlementId: string;
      sellerId: string;
      cycleId: string;
      commissionInvoiceNumber: string | null;
      commissionInvoiceDate: Date | null;
      commissionInvoiceFilingPeriod: string | null;
      commissionPlaceOfSupplyStateCode: string | null;
      commissionInvoiceSupplierGstin: string | null;
      commissionInvoiceRecipientGstin: string | null;
      commissionRecipientIsB2c: boolean;
      commissionInvoiceSacCode: string | null;
      commissionInvoiceIrn: string | null;
      commissionInvoiceCreditNoteForId: string | null;
      totalPlatformMargin: number;
      totalPlatformMarginInPaise: bigint | null;
      cgstOnCommissionInPaise: bigint | null;
      sgstOnCommissionInPaise: bigint | null;
      igstOnCommissionInPaise: bigint | null;
      totalCommissionGstInPaise: bigint | null;
      commissionGstRateBps: number | null;
      commissionGstSplitType: 'CGST_SGST' | 'IGST' | null;
      cycle: { periodEnd: Date; approvedAt: Date | null } | null;
      seller: {
        gstin: string | null;
        legalBusinessName: string | null;
        sellerShopName: string | null;
        gstStateCode: string | null;
      } | null;
    }>
  > {
    const rows = await (this.prisma as any).sellerSettlement.findMany({
      where: {
        OR: [
          { commissionInvoiceFilingPeriod: args.filingPeriod },
          {
            commissionInvoiceFilingPeriod: null,
            cycle: { periodEnd: { gte: args.startUtc, lt: args.endUtc } },
          },
        ],
      },
      include: {
        cycle: { select: { periodEnd: true, approvedAt: true } },
        seller: {
          select: {
            gstin: true,
            legalBusinessName: true,
            sellerShopName: true,
            gstStateCode: true,
          },
        },
      },
      orderBy: [
        { commissionInvoiceDate: 'asc' },
        { createdAt: 'asc' },
      ],
    });
    return rows.map((s: any) => ({
      settlementId: s.id,
      sellerId: s.sellerId,
      cycleId: s.cycleId,
      commissionInvoiceNumber: s.commissionInvoiceNumber ?? null,
      commissionInvoiceDate: s.commissionInvoiceDate ?? null,
      commissionInvoiceFilingPeriod: s.commissionInvoiceFilingPeriod ?? null,
      commissionPlaceOfSupplyStateCode:
        s.commissionPlaceOfSupplyStateCode ?? null,
      commissionInvoiceSupplierGstin:
        s.commissionInvoiceSupplierGstin ?? null,
      commissionInvoiceRecipientGstin:
        s.commissionInvoiceRecipientGstin ?? null,
      commissionRecipientIsB2c: !!s.commissionRecipientIsB2c,
      commissionInvoiceSacCode: s.commissionInvoiceSacCode ?? null,
      commissionInvoiceIrn: s.commissionInvoiceIrn ?? null,
      commissionInvoiceCreditNoteForId:
        s.commissionInvoiceCreditNoteForId ?? null,
      totalPlatformMargin: Number(s.totalPlatformMargin ?? 0),
      totalPlatformMarginInPaise: s.totalPlatformMarginInPaise ?? null,
      cgstOnCommissionInPaise: s.cgstOnCommissionInPaise ?? null,
      sgstOnCommissionInPaise: s.sgstOnCommissionInPaise ?? null,
      igstOnCommissionInPaise: s.igstOnCommissionInPaise ?? null,
      totalCommissionGstInPaise: s.totalCommissionGstInPaise ?? null,
      commissionGstRateBps: s.commissionGstRateBps ?? null,
      commissionGstSplitType: s.commissionGstSplitType ?? null,
      cycle: s.cycle ?? null,
      seller: s.seller ?? null,
    }));
  }
}
