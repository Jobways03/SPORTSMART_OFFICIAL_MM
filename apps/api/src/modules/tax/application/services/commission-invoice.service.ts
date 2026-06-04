// Phase 159aa (Marketplace Commission GSTR-1 audit B1 + B2 + #6 + #10 + #11 + #12)
// — CommissionInvoiceService.
//
// CBIC §31 / Rule 46 obliges the marketplace, as a B2B service supplier
// (SAC 9985, e-commerce operator commission), to issue a tax invoice
// for each commission charge. The previous GSTR-1 export
// (marketplace-commission-gstr.service.ts) aggregated per (seller,
// period) — wrong granularity for §4 B2B which is invoice-by-invoice,
// and there was no underlying invoice document anywhere.
//
// This service snapshots one commission invoice per SellerSettlement
// onto denorm columns we added in migration 20260527230000:
//
//   commissionInvoiceNumber          (CBIC consecutive serial per FY)
//   commissionInvoiceDate            (issue date — drives filing period)
//   commissionInvoiceFilingPeriod    ("YYYY-MM" — IST, equality-indexed)
//   commissionPlaceOfSupplyStateCode (recipient state per IGST §12(2)(a))
//   commissionInvoiceSupplierGstin   (PlatformGstProfile snapshot)
//   commissionInvoiceRecipientGstin  (seller GSTIN snapshot; NULL for B2C)
//   commissionRecipientIsB2c         (explicit B2C flag; closes audit B3)
//   commissionInvoiceSacCode         (snapshot from tax_config)
//   commissionInvoiceIrn             (NULL unless EINVOICE_PROVIDER != 'stub')
//   commissionInvoiceCreditNoteForId (set on §9B reversal rows; null for B2B/B2C)
//
// The service is called from SettlementService.approveCycle via
// applyToCycleOnApprove — same pattern as SettlementTcsHookService /
// SettlementTds194OHookService. Idempotent: rows that already have an
// invoice number are skipped. Errors per-settlement do NOT roll back
// the cycle approval (per the same finance-resilience pattern: TCS /
// TDS / Commission-Invoice failures are reported up; finance retries
// targeted rows via an admin endpoint).
//
// See:
//   - docs/tax/CA.md §A — commission supply, SAC 9985, B2B obligation
//   - apps/api/prisma/schema/migrations/20260527230000_commission_invoice_denorm

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DocumentSequenceService } from './document-sequence.service';
import { PlatformGstProfileService } from './platform-gst-profile.service';
import { TaxConfigService } from './tax-config.service';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Custom sequence-key supplier scope so commission invoices get their
 *  own counter, independent of the regular product-side TAX_INVOICE
 *  series. DocumentSequenceService keys by (supplierGstin, FY, type);
 *  the `MKTCOM:` prefix carves out a sibling series. */
const COMMISSION_SEQUENCE_PREFIX = 'MKTCOM';
/** Document-number visual prefix for commission invoices. CBIC Rule 46
 *  permits multi-series numbering; this prefix makes the commission
 *  invoices visually distinct from regular sale invoices on filings. */
const COMMISSION_DOCUMENT_PREFIX = 'SM-MKTCOM';
const COMMISSION_CREDIT_NOTE_PREFIX = 'SM-MKTCOM-CN';

export interface IssueForSettlementInput {
  settlementId: string;
  /** Invoice date — defaults to settlement.approvedAt or now. */
  invoiceDate?: Date;
  /** For audit log / sequence-skipped tracking. */
  actorId?: string;
}

export interface IssueForSettlementResult {
  settlementId: string;
  alreadyIssued: boolean;
  commissionInvoiceNumber: string;
  commissionInvoiceDate: Date;
  commissionInvoiceFilingPeriod: string;
  commissionInvoiceSupplierGstin: string;
  commissionInvoiceRecipientGstin: string | null;
  commissionRecipientIsB2c: boolean;
  commissionPlaceOfSupplyStateCode: string;
  commissionInvoiceSacCode: string;
}

export interface ApplyToCycleResult {
  cycleId: string;
  invoicesIssued: number;
  invoicesSkipped: number;
  invoicesFailed: number;
  failedSettlementIds: string[];
}

@Injectable()
export class CommissionInvoiceService {
  private readonly logger = new Logger(CommissionInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentSequence: DocumentSequenceService,
    private readonly platformGstProfile: PlatformGstProfileService,
    private readonly taxConfig: TaxConfigService,
  ) {}

  /**
   * Issue (idempotently) a commission tax invoice snapshot onto one
   * SellerSettlement row. Re-calling returns the already-stamped row
   * unchanged — safe under retry.
   */
  async issueForSettlement(
    args: IssueForSettlementInput,
  ): Promise<IssueForSettlementResult> {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: args.settlementId },
      include: {
        seller: {
          select: {
            id: true,
            gstin: true,
            gstStateCode: true,
            legalBusinessName: true,
            sellerShopName: true,
          },
        },
        cycle: { select: { id: true, periodEnd: true, approvedAt: true } },
      },
    });
    if (!settlement) {
      throw new Error(
        `CommissionInvoiceService: settlement ${args.settlementId} not found`,
      );
    }

    // Idempotent — already issued.
    if (settlement.commissionInvoiceNumber) {
      return {
        settlementId: settlement.id,
        alreadyIssued: true,
        commissionInvoiceNumber: settlement.commissionInvoiceNumber,
        commissionInvoiceDate:
          settlement.commissionInvoiceDate ?? new Date(0),
        commissionInvoiceFilingPeriod:
          settlement.commissionInvoiceFilingPeriod ?? '',
        commissionInvoiceSupplierGstin:
          settlement.commissionInvoiceSupplierGstin ?? '',
        commissionInvoiceRecipientGstin:
          settlement.commissionInvoiceRecipientGstin,
        commissionRecipientIsB2c: settlement.commissionRecipientIsB2c,
        commissionPlaceOfSupplyStateCode:
          settlement.commissionPlaceOfSupplyStateCode ?? '',
        commissionInvoiceSacCode:
          settlement.commissionInvoiceSacCode ?? '9985',
      };
    }

    // Supplier identity — never user-supplied; pulled server-side.
    const platformProfile = await this.platformGstProfile.requireDefault();
    const supplierGstin = platformProfile.gstin;

    // Recipient identity — B2C bucket when the seller is not GST-
    // registered. Audit B3: those rows were silently dropped before;
    // now they're explicitly flagged so the GSTR-1 export emits them
    // under §7 B2C aggregated by (state, rate) instead.
    const recipientGstin = settlement.seller?.gstin || null;
    const isB2c = !recipientGstin;

    // Place-of-supply per IGST §12(2)(a): recipient's state of
    // registration for B2B; for unregistered (B2C), seller's address
    // state (we snapshot from seller.gstStateCode here, which the
    // seller profile carries even for non-GSTIN sellers via the
    // address normalisation step). Falls back to '99' (Other
    // Territory) when the seller record lacks a state code so the
    // CSV row is emit-able rather than silently dropped.
    const placeOfSupplyStateCode =
      settlement.seller?.gstStateCode ?? '99';

    // SAC code — Phase 159aa moved out of the hard-coded constant
    // into tax_config so a future CBIC reclassification updates one
    // source. Cached at the TaxConfig layer.
    const sacCode = await this.taxConfig.getString(
      'commission_sac_code',
      '9985',
    );

    // Invoice date drives the filing period. We prefer the cycle's
    // approved-at timestamp so a settlement approved at 23:59 IST on
    // 30 April files under the April month (vs. cycle.periodEnd which
    // may roll into May for weekly cycles). Falls back to NOW when
    // settlement was approved-in-place before the column existed.
    const invoiceDate =
      args.invoiceDate ??
      settlement.cycle?.approvedAt ??
      settlement.cycle?.periodEnd ??
      new Date();
    const filingPeriod = toFilingPeriod(invoiceDate);

    // Allocate the next consecutive number from the dedicated
    // commission series. The MKTCOM: scope prevents collision with
    // the regular product invoices the marketplace also issues on
    // behalf of sellers via the per-seller tax-document flow.
    const fy = DocumentSequenceService.financialYearOf(invoiceDate);
    const sequence = await this.documentSequence.nextNumber({
      supplierGstin: `${COMMISSION_SEQUENCE_PREFIX}:${supplierGstin}`,
      financialYear: fy,
      documentType: 'TAX_INVOICE',
      prefix: COMMISSION_DOCUMENT_PREFIX,
    });

    // Persist the snapshot. Because the migration's partial-unique
    // index gates on commissionInvoiceNumber NOT NULL, a concurrent
    // duplicate-issue is rejected at the DB layer; we catch the
    // unique-violation and re-fetch the existing row (idempotent
    // recovery instead of a 500).
    try {
      await this.prisma.sellerSettlement.update({
        where: { id: settlement.id },
        data: {
          commissionInvoiceNumber: sequence.documentNumber,
          commissionInvoiceDate: invoiceDate,
          commissionInvoiceFilingPeriod: filingPeriod,
          commissionPlaceOfSupplyStateCode: placeOfSupplyStateCode,
          commissionInvoiceSupplierGstin: supplierGstin,
          commissionInvoiceRecipientGstin: recipientGstin,
          commissionRecipientIsB2c: isB2c,
          commissionInvoiceSacCode: sacCode,
        },
      });
    } catch (err) {
      // P2002 (Prisma unique violation) — another concurrent issue
      // won the race. Treat as idempotent — re-read the row.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const refreshed = await this.prisma.sellerSettlement.findUnique({
        where: { id: settlement.id },
      });
      if (refreshed?.commissionInvoiceNumber) {
        return {
          settlementId: refreshed.id,
          alreadyIssued: true,
          commissionInvoiceNumber: refreshed.commissionInvoiceNumber,
          commissionInvoiceDate:
            refreshed.commissionInvoiceDate ?? new Date(0),
          commissionInvoiceFilingPeriod:
            refreshed.commissionInvoiceFilingPeriod ?? '',
          commissionInvoiceSupplierGstin:
            refreshed.commissionInvoiceSupplierGstin ?? supplierGstin,
          commissionInvoiceRecipientGstin:
            refreshed.commissionInvoiceRecipientGstin,
          commissionRecipientIsB2c: refreshed.commissionRecipientIsB2c,
          commissionPlaceOfSupplyStateCode:
            refreshed.commissionPlaceOfSupplyStateCode ?? '',
          commissionInvoiceSacCode:
            refreshed.commissionInvoiceSacCode ?? sacCode,
        };
      }
      throw err;
    }

    this.logger.log(
      `Commission invoice issued: settlement=${settlement.id} ` +
        `number=${sequence.documentNumber} fy=${fy} ` +
        `period=${filingPeriod} b2c=${isB2c} pos=${placeOfSupplyStateCode}`,
    );
    return {
      settlementId: settlement.id,
      alreadyIssued: false,
      commissionInvoiceNumber: sequence.documentNumber,
      commissionInvoiceDate: invoiceDate,
      commissionInvoiceFilingPeriod: filingPeriod,
      commissionInvoiceSupplierGstin: supplierGstin,
      commissionInvoiceRecipientGstin: recipientGstin,
      commissionRecipientIsB2c: isB2c,
      commissionPlaceOfSupplyStateCode: placeOfSupplyStateCode,
      commissionInvoiceSacCode: sacCode,
    };
  }

  /**
   * Bulk-issue commission invoices for every SellerSettlement in the
   * cycle. Same pattern as SettlementTcsHookService.applyToCycleOnApprove:
   * idempotent skip on already-issued rows, per-row failure isolation,
   * aggregate counts returned for the admin response.
   */
  async applyToCycleOnApprove(args: {
    cycleId: string;
    actorId?: string;
  }): Promise<ApplyToCycleResult> {
    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { cycleId: args.cycleId },
      select: { id: true, commissionInvoiceNumber: true },
    });
    let issued = 0;
    let skipped = 0;
    const failed: string[] = [];
    for (const s of settlements) {
      if (s.commissionInvoiceNumber) {
        skipped++;
        continue;
      }
      try {
        const result = await this.issueForSettlement({
          settlementId: s.id,
          actorId: args.actorId,
        });
        if (result.alreadyIssued) skipped++;
        else issued++;
      } catch (err) {
        failed.push(s.id);
        this.logger.error(
          `Commission invoice issue failed for settlement ${s.id}: ` +
            `${(err as Error).message} — settlement left WITHOUT invoice; ` +
            'finance must re-run via admin endpoint.',
        );
      }
    }
    if (failed.length > 0) {
      this.logger.error(
        `Commission invoice apply-on-approve cycle ${args.cycleId} ` +
          `had ${failed.length} failure(s): ${failed.join(', ')}`,
      );
    }
    this.logger.log(
      `Commission invoices applied to cycle ${args.cycleId}: ` +
        `issued=${issued} skipped=${skipped} failed=${failed.length}`,
    );
    return {
      cycleId: args.cycleId,
      invoicesIssued: issued,
      invoicesSkipped: skipped,
      invoicesFailed: failed.length,
      failedSettlementIds: failed,
    };
  }

  /**
   * Issue a §9B credit-note number for a commission reversal. Used by
   * the GSTR-1 exporter when a settlement carries a negative commission
   * (return-driven). Reuses the same MKTCOM scope but with the
   * CREDIT_NOTE document type so the counter is independent of the
   * positive-invoice series.
   *
   * Returns the allocated credit-note number; caller persists the link
   * via commissionInvoiceCreditNoteForId.
   */
  async issueCreditNoteForReversal(args: {
    settlementId: string;
    originalCommissionInvoiceNumber: string;
    invoiceDate?: Date;
  }): Promise<{ creditNoteNumber: string; filingPeriod: string }> {
    const platformProfile = await this.platformGstProfile.requireDefault();
    const supplierGstin = platformProfile.gstin;
    const invoiceDate = args.invoiceDate ?? new Date();
    const fy = DocumentSequenceService.financialYearOf(invoiceDate);
    const sequence = await this.documentSequence.nextNumber({
      supplierGstin: `${COMMISSION_SEQUENCE_PREFIX}:${supplierGstin}`,
      financialYear: fy,
      documentType: 'CREDIT_NOTE',
      prefix: COMMISSION_CREDIT_NOTE_PREFIX,
    });
    return {
      creditNoteNumber: sequence.documentNumber,
      filingPeriod: toFilingPeriod(invoiceDate),
    };
  }
}

/**
 * Convert a Date to a CBIC GSTR-1 filing period — "YYYY-MM" in IST.
 * Mirrors the same offset arithmetic used by gstr1-report,
 * gstr3b-report and the TCS service so filing-period membership is
 * consistent across every export this audit chain touches.
 */
function toFilingPeriod(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + 1;
  return `${y}-${m.toString().padStart(2, '0')}`;
}
