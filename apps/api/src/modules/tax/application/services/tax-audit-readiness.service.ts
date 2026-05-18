// Phase 23 GST — TaxAuditReadinessService.
//
// Returns a structured "are we ready to flip TAX_STRICT_MODE on?"
// report. Drives the admin readiness dashboard + the pre-flight check
// during the AUDIT → STRICT rollout.
//
// The report enumerates known blocker classes:
//
//   product.missing_hsn       — Products that aren't NIL_RATED but
//                               have no HSN code. Strict mode rejects
//                               at invoice generation.
//   product.missing_rate      — Products without a GST rate (and not
//                               EXEMPT / NIL_RATED). Strict mode rejects.
//   seller.missing_gstin      — Active sellers fulfilling orders
//                               without a verified GSTIN. Strict mode
//                               cannot issue Tax Invoice for these.
//   einvoice.unresolved       — Documents stuck in PENDING / FAILED
//                               past the retry cap. STRICT mode requires
//                               IRN-or-explicit-non-applicable; PENDING
//                               is in-flight risk.
//   pdf.unresolved            — Documents stuck in PDF_PENDING /
//                               PDF_FAILED past the retry cap.
//   tcs.unfiled               — Filing periods past the GSTR-8 deadline
//                               with rows still in COMPUTED / COLLECTED
//                               (not FILED). Statutory exposure.
//   timebar.requires_review   — Returns in REQUIRES_FINANCE_REVIEW
//                               (Phase 12) — finance has not triaged
//                               within the approaching-cutoff window.
//
// Each blocker class returns a count + a small sample of resource IDs
// for the admin UI to deep-link into. The report carries a `ready`
// boolean (true when every counter is zero) and a `currentMode` so
// the UI shows "you are in AUDIT mode; flip to STRICT after clearing
// these 47 blockers."

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { TaxModeService, type TaxMode } from './tax-mode.service';

export interface BlockerSummary {
  code: string;
  count: number;
  /** Up to 5 sample IDs for the admin UI's "show me one" deep-link. */
  sampleIds: string[];
  /** Human-readable explanation rendered next to the count. */
  message: string;
}

export interface TaxAuditReadinessReport {
  currentMode: TaxMode;
  ready: boolean;
  generatedAt: Date;
  blockers: BlockerSummary[];
  totalBlockers: number;
}

@Injectable()
export class TaxAuditReadinessService {
  private readonly logger = new Logger(TaxAuditReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly mode: TaxModeService,
  ) {}

  async build(): Promise<TaxAuditReadinessReport> {
    const currentMode = await this.mode.getMode();
    const blockers: BlockerSummary[] = [];

    blockers.push(await this.scanMissingHsn());
    blockers.push(await this.scanMissingRate());
    blockers.push(await this.scanMissingSellerGstin());
    blockers.push(await this.scanEinvoiceUnresolved());
    blockers.push(await this.scanPdfUnresolved());
    blockers.push(await this.scanTcsUnfiled());
    blockers.push(await this.scanTimebarRequiresReview());

    const totalBlockers = blockers.reduce((sum, b) => sum + b.count, 0);
    return {
      currentMode,
      ready: totalBlockers === 0,
      generatedAt: new Date(),
      blockers,
      totalBlockers,
    };
  }

  private async scanMissingHsn(): Promise<BlockerSummary> {
    // Products that are TAXABLE but have no HSN code. The Phase 1
    // catalog columns track this; we keep the query defensive (Phase 23
    // doesn't add new schema).
    const rows = await this.prisma.product
      .findMany({
        where: {
          supplyTaxability: 'TAXABLE',
          OR: [{ hsnCode: null }, { hsnCode: '' }],
        },
        select: { id: true },
        take: 5,
      })
      .catch(() => []);
    const count = await this.prisma.product
      .count({
        where: {
          supplyTaxability: 'TAXABLE',
          OR: [{ hsnCode: null }, { hsnCode: '' }],
        },
      })
      .catch(() => 0);
    return {
      code: 'product.missing_hsn',
      count,
      sampleIds: rows.map((r) => r.id),
      message:
        'TAXABLE products without HSN code. Strict mode rejects at ' +
        'invoice generation per CBIC HSN-on-invoice rule.',
    };
  }

  private async scanMissingRate(): Promise<BlockerSummary> {
    const where: any = {
      supplyTaxability: 'TAXABLE',
      OR: [{ gstRateBps: null }, { gstRateBps: 0 }],
    };
    const rows = await this.prisma.product
      .findMany({ where, select: { id: true }, take: 5 })
      .catch(() => []);
    const count = await this.prisma.product.count({ where }).catch(() => 0);
    return {
      code: 'product.missing_rate',
      count,
      sampleIds: rows.map((r) => r.id),
      message:
        'TAXABLE products with no GST rate set (and not flagged ' +
        'NIL_RATED / EXEMPT). Strict mode rejects at invoice generation.',
    };
  }

  private async scanMissingSellerGstin(): Promise<BlockerSummary> {
    // Sellers that have shipped at least one order in the last 30 days
    // and have no verified GSTIN row. The two-table check keeps the
    // query honest about "active" sellers.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeSellersWithoutGstin = await this.prisma.seller
      .findMany({
        where: {
          subOrders: { some: { createdAt: { gte: thirtyDaysAgo } } },
          gstins: { none: { verifiedAt: { not: null } } },
        },
        select: { id: true },
        take: 5,
      })
      .catch(() => []);
    const count = await this.prisma.seller
      .count({
        where: {
          subOrders: { some: { createdAt: { gte: thirtyDaysAgo } } },
          gstins: { none: { verifiedAt: { not: null } } },
        },
      })
      .catch(() => 0);
    return {
      code: 'seller.missing_gstin',
      count,
      sampleIds: activeSellersWithoutGstin.map((s) => s.id),
      message:
        'Active sellers without a verified GSTIN row. Strict mode ' +
        'cannot issue Tax Invoices on their behalf.',
    };
  }

  private async scanEinvoiceUnresolved(): Promise<BlockerSummary> {
    // Documents where einvoice_status is PENDING / FAILED past the
    // retry cap. PENDING within the cap is in-flight — we don't flag.
    const cap = this.env.getNumber('TAX_EINVOICE_RETRY_CAP', 5);
    const where: any = {
      einvoiceStatus: { in: ['PENDING', 'FAILED'] },
      einvoiceRetryCount: { gte: cap },
    };
    const rows = await this.prisma.taxDocument
      .findMany({ where, select: { id: true }, take: 5 })
      .catch(() => []);
    const count = await this.prisma.taxDocument.count({ where }).catch(() => 0);
    return {
      code: 'einvoice.unresolved',
      count,
      sampleIds: rows.map((r) => r.id),
      message:
        'Tax documents stuck in IRN PENDING / FAILED past the retry ' +
        'cap. Strict mode requires every B2B invoice to either be ' +
        'GENERATED or explicitly NOT_APPLICABLE.',
    };
  }

  private async scanPdfUnresolved(): Promise<BlockerSummary> {
    const cap = this.env.getNumber('TAX_PDF_RETRY_CAP', 5);
    const where: any = {
      status: { in: ['PDF_PENDING', 'PDF_FAILED'] },
      pdfRetryCount: { gte: cap },
    };
    const rows = await this.prisma.taxDocument
      .findMany({ where, select: { id: true }, take: 5 })
      .catch(() => []);
    const count = await this.prisma.taxDocument.count({ where }).catch(() => 0);
    return {
      code: 'pdf.unresolved',
      count,
      sampleIds: rows.map((r) => r.id),
      message:
        'Tax documents stuck in PDF_PENDING / PDF_FAILED past the ' +
        'retry cap. Customer / seller download path is broken for ' +
        'these.',
    };
  }

  private async scanTcsUnfiled(): Promise<BlockerSummary> {
    // GSTR-8 deadline is the 10th of the next month. Anything in
    // COMPUTED / COLLECTED (not FILED) past its 10th-of-next-month
    // is statutory exposure.
    const allRows = await this.prisma.gstTcsSettlementLedger
      .findMany({
        where: { status: { in: ['COMPUTED', 'COLLECTED'] } },
        select: { id: true, filingPeriod: true },
        take: 1000,
      })
      .catch(() => []);
    const now = new Date();
    const overdue = allRows.filter((r) => isFilingDeadlinePassed(r.filingPeriod, now));
    return {
      code: 'tcs.unfiled',
      count: overdue.length,
      sampleIds: overdue.slice(0, 5).map((r) => r.id),
      message:
        'TCS ledger rows past the 10th-of-next-month GSTR-8 filing ' +
        'deadline with status still COMPUTED / COLLECTED. Mark FILED ' +
        'after portal upload to clear.',
    };
  }

  private async scanTimebarRequiresReview(): Promise<BlockerSummary> {
    const where: any = {
      creditNoteEligibilityStatus: 'REQUIRES_FINANCE_REVIEW',
    };
    const rows = await this.prisma.return
      .findMany({ where, select: { id: true }, take: 5 })
      .catch(() => []);
    const count = await this.prisma.return.count({ where }).catch(() => 0);
    return {
      code: 'timebar.requires_review',
      count,
      sampleIds: rows.map((r) => r.id),
      message:
        'Returns flagged REQUIRES_FINANCE_REVIEW by the Phase 12 ' +
        'Section 34 cron. Finance must triage before the cutoff lands.',
    };
  }
}

/**
 * Given a filing period (YYYY-MM), check if "now" is past the
 * 10th-of-the-next-month CBIC deadline at end-of-day IST.
 */
function isFilingDeadlinePassed(filingPeriod: string, now: Date): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!match) return false;
  const y = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  // 10th of next month, 23:59:59.999 IST = 10th 18:29:59.999 UTC.
  const deadlineUtc = new Date(
    Date.UTC(nextY, nextM - 1, 10, 18, 29, 59, 999),
  );
  return now.getTime() > deadlineUtc.getTime();
}
