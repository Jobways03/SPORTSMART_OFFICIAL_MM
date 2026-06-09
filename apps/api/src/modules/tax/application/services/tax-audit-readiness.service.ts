// Phase 23 GST — TaxAuditReadinessService.
//
// Returns a structured "are we ready to flip TAX_STRICT_MODE on?"
// report. Drives the admin readiness dashboard, the pre-flight gate
// during the AUDIT → STRICT rollout (TaxModeService.setMode), AND the
// STRICT-mode export readiness gate (AdminTaxReportsController).
//
// Phase 163 (Tax Audit Readiness Dashboard audit remediation) — the
// scan was global-only, swallowed every DB error into "ready", capped
// the TCS scan at 1000 in-memory rows, and covered only ~half the
// blocker classes the rollout actually cares about. This rewrite:
//
//   #1  TCS overdue detection is a WHERE-clause (filingPeriod <= the
//       latest overdue period) — no take:1000 truncation.
//   #2  Adds the missing blocker classes: missing UQC, stuck DRAFT
//       invoices, unresolved e-way bills, undeposited §194-O TDS,
//       missing platform GST profile, GSTIN legal-name mismatch.
//   #4  NO .catch(() => 0). A DB error PROPAGATES — a visible 500 is
//       far safer than a false "ready: true" that greenlights STRICT.
//   #6  Optional ScanFilter (sellerId / filingPeriod / gstProfileId)
//       threaded into every scan that can be scoped.
//   #8  All scans run concurrently (Promise.all).
//   #9  count + sample run concurrently per scan (one round-trip of
//       latency each) — the UI needs both an exact count AND sample
//       IDs, so the two queries are inherent, not redundant.
//   #11 Each blocker carries a severity (CRITICAL/HIGH/MEDIUM/LOW).
//   #12 Each blocker carries a resourceType so the UI deep-link is
//       data-driven, not a hard-coded per-code switch.
//   #13 Legal-name-mismatch is its own blocker (the SellerGstin
//       columns added in Phase 161 — isVerified / legalNameMismatch).
//   #15 Product scans are scoped to ACTIVE, non-deleted products —
//       only those can actually be invoiced.
//   #16 persistSnapshot() / history() back the trend table + cron.
//   #19 The "active seller" window is configurable (default 90 days).
//
// Each blocker class returns a count + a small sample of resource IDs
// for the admin UI to deep-link into. The report carries a `ready`
// boolean (true when every counter is zero), a `criticalBlockers`
// rollup, and a `currentMode`.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { TaxModeService, type TaxMode } from './tax-mode.service';

/** #11 — severity tier for a blocker class. */
export type BlockerSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * #12 — the kind of resource the sampleIds point at, so the UI can
 * build the deep-link from the report instead of a hard-coded per-code
 * mapping. A new scanner becomes navigable without a frontend change.
 */
export type BlockerResourceType =
  | 'product'
  | 'seller'
  | 'taxDocument'
  | 'return'
  | 'tcsLedger'
  | 'tdsLedger'
  | 'ewayBill'
  | 'platformGstProfile';

/**
 * #6 — optional scope. When omitted the scan is platform-wide (the
 * dashboard default). The STRICT-export gate passes sellerId so a
 * per-seller GSTR export only blocks on that seller's gaps (plus the
 * platform-wide gaps that block everyone, e.g. a missing platform GST
 * profile).
 */
export interface ScanFilter {
  sellerId?: string | null;
  filingPeriod?: string | null;
  gstProfileId?: string | null;
}

export interface BlockerSummary {
  code: string;
  severity: BlockerSeverity;
  resourceType: BlockerResourceType;
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
  /** #11 — rollup of CRITICAL-severity blocker counts for the KPI strip. */
  criticalBlockers: number;
  /** #6 — echoes the scope this report was built for (null = platform-wide). */
  filter: { sellerId: string | null; filingPeriod: string | null; gstProfileId: string | null };
}

const SAMPLE_SIZE = 5;

@Injectable()
export class TaxAuditReadinessService {
  private readonly logger = new Logger(TaxAuditReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly mode: TaxModeService,
  ) {}

  async build(filter: ScanFilter = {}): Promise<TaxAuditReadinessReport> {
    const currentMode = await this.mode.getMode();
    const now = new Date();

    // #8 — every scan runs concurrently. #4 — NONE of these swallow
    // their errors; a rejection here propagates out of build() so the
    // controller returns a 500 instead of a false "ready: true".
    const blockers = await Promise.all([
      this.scanMissingHsn(filter),
      this.scanMissingRate(filter),
      this.scanMissingUqc(filter),
      this.scanUnverifiedConfig(filter),
      this.scanMissingSellerGstin(filter),
      this.scanSellerGstinLegalNameMismatch(filter),
      this.scanMissingPlatformGstProfile(filter),
      this.scanDraftInvoicesStuck(filter),
      this.scanEinvoiceUnresolved(filter),
      this.scanPdfUnresolved(filter),
      this.scanEwayBillUnresolved(filter),
      this.scanTcsUnfiled(filter, now),
      this.scanTdsWithheld(filter),
      this.scanTimebarRequiresReview(filter),
    ]);

    const totalBlockers = blockers.reduce((sum, b) => sum + b.count, 0);
    const criticalBlockers = blockers
      .filter((b) => b.severity === 'CRITICAL')
      .reduce((sum, b) => sum + b.count, 0);

    return {
      currentMode,
      ready: totalBlockers === 0,
      generatedAt: now,
      blockers,
      totalBlockers,
      criticalBlockers,
      filter: {
        sellerId: filter.sellerId ?? null,
        filingPeriod: filter.filingPeriod ?? null,
        gstProfileId: filter.gstProfileId ?? null,
      },
    };
  }

  // ── #16 history persistence ─────────────────────────────────────

  /**
   * #16 — persist a point-in-time snapshot so the trend table can
   * answer "is readiness improving?". Written by the 6-hourly cron;
   * non-throwing at the call site is the caller's choice (the cron
   * wraps it) — here we let a write error surface.
   */
  async persistSnapshot(report: TaxAuditReadinessReport): Promise<void> {
    await this.prisma.taxReadinessSnapshot.create({
      data: {
        currentMode: report.currentMode,
        ready: report.ready,
        totalBlockers: report.totalBlockers,
        criticalBlockers: report.criticalBlockers,
        blockersJson: report.blockers as unknown as object,
        generatedAt: report.generatedAt,
      },
    });
  }

  /** #16 — recent snapshots (newest first) within the trailing window. */
  async history(days = 30): Promise<
    Array<{
      id: string;
      currentMode: string;
      ready: boolean;
      totalBlockers: number;
      criticalBlockers: number;
      generatedAt: Date;
    }>
  > {
    const clampedDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const since = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000);
    return this.prisma.taxReadinessSnapshot.findMany({
      where: { generatedAt: { gte: since } },
      select: {
        id: true,
        currentMode: true,
        ready: true,
        totalBlockers: true,
        criticalBlockers: true,
        generatedAt: true,
      },
      orderBy: { generatedAt: 'desc' },
      take: 2000,
    });
  }

  // ── Scanners ────────────────────────────────────────────────────

  /**
   * #9 — count + sample in a single round-trip of latency (run
   * concurrently). No .catch (#4): a query failure rejects, and
   * Promise.all in build() propagates it.
   */
  private async countAndSample(
    delegate: { count: (a: any) => Promise<number>; findMany: (a: any) => Promise<Array<{ id: string }>> },
    where: any,
  ): Promise<{ count: number; sampleIds: string[] }> {
    const [count, rows] = await Promise.all([
      delegate.count({ where }),
      delegate.findMany({ where, select: { id: true }, take: SAMPLE_SIZE }),
    ]);
    return { count, sampleIds: rows.map((r) => r.id) };
  }

  /**
   * #15 — only ACTIVE, non-deleted products can be invoiced; DRAFT /
   * ARCHIVED / soft-deleted products are not a filing risk and would
   * inflate the count. #6 — scoped to a seller when one is supplied.
   */
  private activeProductWhere(base: Record<string, unknown>, filter: ScanFilter): Record<string, unknown> {
    return {
      ...base,
      status: 'ACTIVE',
      isDeleted: false,
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
    };
  }

  private async scanMissingHsn(filter: ScanFilter): Promise<BlockerSummary> {
    const where = this.activeProductWhere(
      { supplyTaxability: 'TAXABLE', OR: [{ hsnCode: null }, { hsnCode: '' }] },
      filter,
    );
    const { count, sampleIds } = await this.countAndSample(this.prisma.product, where);
    return {
      code: 'product.missing_hsn',
      severity: 'HIGH',
      resourceType: 'product',
      count,
      sampleIds,
      message:
        'ACTIVE TAXABLE products without an HSN code. Strict mode rejects ' +
        'at invoice generation per the CBIC HSN-on-invoice rule.',
    };
  }

  private async scanMissingRate(filter: ScanFilter): Promise<BlockerSummary> {
    // gstRateBps is a non-nullable `Int @default(0)`, so "no rate set" is 0 (or
    // any erroneous negative) — it can never be null. The previous
    // `{ gstRateBps: null }` branch passed null as a filter on a required scalar,
    // which Prisma rejects with "Argument `gstRateBps` is missing", 500-ing the
    // entire audit-readiness endpoint.
    const where = this.activeProductWhere(
      { supplyTaxability: 'TAXABLE', gstRateBps: { lte: 0 } },
      filter,
    );
    const { count, sampleIds } = await this.countAndSample(this.prisma.product, where);
    return {
      code: 'product.missing_rate',
      severity: 'HIGH',
      resourceType: 'product',
      count,
      sampleIds,
      message:
        'ACTIVE TAXABLE products with no GST rate set (and not flagged ' +
        'NIL_RATED / EXEMPT). Strict mode rejects at invoice generation.',
    };
  }

  /**
   * Phase 163 (#2) — TAXABLE products with HSN + rate set but no UQC.
   * Section 31 / Rule 46 requires the Unit Quantity Code on a Tax
   * Invoice; STRICT-mode invoice generation needs it.
   */
  private async scanMissingUqc(filter: ScanFilter): Promise<BlockerSummary> {
    const where = this.activeProductWhere(
      {
        supplyTaxability: 'TAXABLE',
        OR: [{ defaultUqcCode: null }, { defaultUqcCode: '' }],
      },
      filter,
    );
    const { count, sampleIds } = await this.countAndSample(this.prisma.product, where);
    return {
      code: 'product.missing_uqc',
      severity: 'MEDIUM',
      resourceType: 'product',
      count,
      sampleIds,
      message:
        'ACTIVE TAXABLE products without a UQC (Unit Quantity Code). ' +
        'Required on the Tax Invoice under Section 31 / Rule 46.',
    };
  }

  /**
   * Phase 45 — TAXABLE products that DO have HSN + rate but have NOT
   * been attested by an admin. STRICT-mode invoice generation refuses
   * to emit a Tax Invoice for these. #15 — ACTIVE / non-deleted only.
   */
  private async scanUnverifiedConfig(filter: ScanFilter): Promise<BlockerSummary> {
    const where = this.activeProductWhere(
      {
        supplyTaxability: 'TAXABLE',
        taxConfigVerified: false,
        AND: [{ hsnCode: { not: null } }, { hsnCode: { not: '' } }, { gstRateBps: { gt: 0 } }],
      },
      filter,
    );
    const { count, sampleIds } = await this.countAndSample(this.prisma.product, where);
    return {
      code: 'product.unverified_config',
      severity: 'MEDIUM',
      resourceType: 'product',
      count,
      sampleIds,
      message:
        'ACTIVE TAXABLE products with HSN + rate set but no admin ' +
        'attestation. Strict mode refuses to issue Tax Invoices for these — ' +
        'admin must call PATCH /admin/products/:id/verify-tax-config.',
    };
  }

  private async scanMissingSellerGstin(filter: ScanFilter): Promise<BlockerSummary> {
    // #19 — the "active seller" window is configurable (default 90 days),
    // not a hardcoded 30. #13 — uses the first-class isVerified column
    // (Phase 161): true ONLY when the GSTIN was found AND is ACTIVE on
    // the portal. A failed re-check no longer looks "verified".
    const windowDays = this.activeSellerWindowDays();
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const where: any = {
      subOrders: { some: { createdAt: { gte: cutoff } } },
      gstins: { none: { isVerified: true } },
      ...(filter.sellerId ? { id: filter.sellerId } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.seller, where);
    return {
      code: 'seller.missing_gstin',
      severity: 'CRITICAL',
      resourceType: 'seller',
      count,
      sampleIds,
      message:
        `Active sellers (supplied within ${windowDays} days) without a ` +
        'verified GSTIN. Strict mode cannot issue Tax Invoices on their behalf.',
    };
  }

  /**
   * Phase 163 (#13) — sellers whose GSTIN verified BUT whose portal
   * legal name did not match the registered legal name. Previously
   * invisible: a verified-but-mismatched GSTIN passed the missing_gstin
   * scan. The legalNameMismatch column (Phase 161) makes it queryable.
   */
  private async scanSellerGstinLegalNameMismatch(filter: ScanFilter): Promise<BlockerSummary> {
    const windowDays = this.activeSellerWindowDays();
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const where: any = {
      subOrders: { some: { createdAt: { gte: cutoff } } },
      gstins: { some: { legalNameMismatch: true, isActive: true } },
      ...(filter.sellerId ? { id: filter.sellerId } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.seller, where);
    return {
      code: 'seller.gstin_legal_name_mismatch',
      severity: 'HIGH',
      resourceType: 'seller',
      count,
      sampleIds,
      message:
        'Active sellers with a verified GSTIN whose GSTN-portal legal name ' +
        'does not match the registered legal name. The invoice legal name ' +
        'would be wrong — resolve before filing.',
    };
  }

  /**
   * Phase 163 (#2) — the platform must have a default, active GSTIN
   * profile or it cannot file anything (GSTR-8, marketplace GSTR-1) or
   * issue OWN_BRAND invoices. A single missing/inactive default blocks
   * EVERYTHING, so this is platform-wide regardless of any sellerId
   * scope.
   */
  private async scanMissingPlatformGstProfile(_filter: ScanFilter): Promise<BlockerSummary> {
    const existing = await this.prisma.platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      select: { id: true },
    });
    const missing = existing === null;
    return {
      code: 'platform.gst_profile_missing',
      severity: 'CRITICAL',
      resourceType: 'platformGstProfile',
      count: missing ? 1 : 0,
      sampleIds: [],
      message:
        'No default, active Platform GST profile. The platform cannot file ' +
        'GSTR-8 / marketplace GSTR-1 or issue OWN_BRAND invoices without it.',
    };
  }

  /**
   * Phase 163 (#2) — tax documents stuck in DRAFT past the stale window.
   * In STRICT mode every issued invoice should reach GENERATED; a DRAFT
   * older than the window is a stuck row, not an in-flight one. The
   * window keeps freshly-created drafts (normal mid-flight state) out of
   * the count.
   */
  private async scanDraftInvoicesStuck(filter: ScanFilter): Promise<BlockerSummary> {
    const staleHours = this.env.getNumber('TAX_AUDIT_READINESS_DRAFT_STALE_HOURS', 24);
    const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);
    const where: any = {
      status: 'DRAFT',
      createdAt: { lt: cutoff },
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
      ...(filter.gstProfileId ? { platformGstProfileId: filter.gstProfileId } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.taxDocument, where);
    return {
      code: 'invoice.draft_stuck',
      severity: 'MEDIUM',
      resourceType: 'taxDocument',
      count,
      sampleIds,
      message:
        `Tax documents stuck in DRAFT for more than ${staleHours}h. In strict ` +
        'mode every issued invoice should reach GENERATED — investigate the stall.',
    };
  }

  private async scanEinvoiceUnresolved(filter: ScanFilter): Promise<BlockerSummary> {
    const cap = this.env.getNumber('TAX_EINVOICE_RETRY_CAP', 5);
    const where: any = {
      einvoiceStatus: { in: ['PENDING', 'FAILED'] },
      einvoiceRetryCount: { gte: cap },
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
      ...(filter.gstProfileId ? { platformGstProfileId: filter.gstProfileId } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.taxDocument, where);
    return {
      code: 'einvoice.unresolved',
      severity: 'HIGH',
      resourceType: 'taxDocument',
      count,
      sampleIds,
      message:
        'Tax documents stuck in IRN PENDING / FAILED past the retry cap. ' +
        'Strict mode requires every B2B invoice to be GENERATED or ' +
        'explicitly NOT_APPLICABLE.',
    };
  }

  private async scanPdfUnresolved(filter: ScanFilter): Promise<BlockerSummary> {
    const cap = this.env.getNumber('TAX_PDF_RETRY_CAP', 5);
    const where: any = {
      status: { in: ['PDF_PENDING', 'PDF_FAILED'] },
      pdfRetryCount: { gte: cap },
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
      ...(filter.gstProfileId ? { platformGstProfileId: filter.gstProfileId } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.taxDocument, where);
    return {
      code: 'pdf.unresolved',
      severity: 'MEDIUM',
      resourceType: 'taxDocument',
      count,
      sampleIds,
      message:
        'Tax documents stuck in PDF_PENDING / PDF_FAILED past the retry cap. ' +
        'Customer / seller download path is broken for these.',
    };
  }

  /**
   * Phase 163 (#2) — e-way bills stuck in an unresolved state. PENDING
   * (adapter call never settled), CANCELLATION_PENDING /
   * CANCELLATION_FAILED (a crash or NIC error left a GENERATED↔cancelled
   * drift the reconcile cron hasn't settled). All are compliance drift.
   * Platform-wide (the model has no direct sellerId).
   */
  private async scanEwayBillUnresolved(_filter: ScanFilter): Promise<BlockerSummary> {
    const where: any = {
      status: { in: ['PENDING', 'CANCELLATION_PENDING', 'CANCELLATION_FAILED'] },
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.eWayBill, where);
    return {
      code: 'ewaybill.unresolved',
      severity: 'MEDIUM',
      resourceType: 'ewayBill',
      count,
      sampleIds,
      message:
        'E-way bills stuck in PENDING / CANCELLATION_PENDING / ' +
        'CANCELLATION_FAILED. The NIC↔DB state may have drifted — let the ' +
        'reconcile cron settle them or resolve manually.',
    };
  }

  /**
   * Phase 163 (#1) — TCS ledger rows past the GSTR-8 filing deadline.
   * The overdue test is now a WHERE-clause predicate on filingPeriod
   * (lexicographic YYYY-MM compare == chronological), so there is NO
   * take:1000 truncation — every overdue row counts, at any scale.
   */
  private async scanTcsUnfiled(filter: ScanFilter, now: Date): Promise<BlockerSummary> {
    const latestOverdue = latestOverdueTcsPeriod(now);
    const where: any = {
      status: { in: ['COMPUTED', 'COLLECTED'] },
      filingPeriod: { lte: latestOverdue },
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
      ...(filter.filingPeriod ? { filingPeriod: filter.filingPeriod } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.gstTcsSettlementLedger, where);
    return {
      code: 'tcs.unfiled',
      severity: 'CRITICAL',
      resourceType: 'tcsLedger',
      count,
      sampleIds,
      message:
        'TCS ledger rows past the 10th-of-next-month GSTR-8 deadline with ' +
        'status still COMPUTED / COLLECTED. Statutory exposure — mark FILED ' +
        'after portal upload to clear.',
    };
  }

  /**
   * Phase 163 (#2) — §194-O TDS amounts WITHHELD from sellers but not
   * yet DEPOSITED with the Income Tax Department. Withheld-but-not-
   * deposited is statutory exposure (the deposit deadline follows the
   * quarter); flagging every WITHHELD row is the conservative, correct
   * bias for a readiness gate.
   */
  private async scanTdsWithheld(filter: ScanFilter): Promise<BlockerSummary> {
    const where: any = {
      status: 'WITHHELD',
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
      ...(filter.filingPeriod ? { filingPeriod: filter.filingPeriod } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.section194OTdsLedger, where);
    return {
      code: 'tds.withheld_undeposited',
      severity: 'CRITICAL',
      resourceType: 'tdsLedger',
      count,
      sampleIds,
      message:
        'Section 194-O TDS WITHHELD from sellers but not yet DEPOSITED with ' +
        'the Income Tax Department (challan pending). Statutory exposure.',
    };
  }

  private async scanTimebarRequiresReview(filter: ScanFilter): Promise<BlockerSummary> {
    const where: any = {
      creditNoteEligibilityStatus: 'REQUIRES_FINANCE_REVIEW',
      ...(filter.sellerId ? { sellerIdSnapshot: filter.sellerId } : {}),
    };
    const { count, sampleIds } = await this.countAndSample(this.prisma.return, where);
    return {
      code: 'timebar.requires_review',
      severity: 'HIGH',
      resourceType: 'return',
      count,
      sampleIds,
      message:
        'Returns flagged REQUIRES_FINANCE_REVIEW by the Section 34 cron. ' +
        'Finance must triage before the credit-note cutoff lands.',
    };
  }

  private activeSellerWindowDays(): number {
    return this.env.getNumber('TAX_AUDIT_READINESS_ACTIVE_SELLER_WINDOW_DAYS', 90);
  }
}

/**
 * Phase 163 (#1) — the latest filing period (YYYY-MM) whose GSTR-8
 * deadline (10th of the FOLLOWING month, 23:59:59 IST) has already
 * passed as of `now`. Every period <= this is overdue, so the scan can
 * select with a single `filingPeriod <= cutoff` predicate.
 *
 * Reasoning: period P's deadline is the 10th of (P + 1 month). So the
 * just-closed month (current − 1) is overdue once we're past the 10th
 * of the current IST month; before the 10th, only (current − 2) and
 * earlier are overdue.
 */
export function latestOverdueTcsPeriod(now: Date): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + 1; // 1-12
  const day = ist.getUTCDate();
  // Past the 10th → (current − 1) is overdue; otherwise step back one more.
  const offset = day > 10 ? 1 : 2;
  let mm = m - offset;
  let yy = y;
  while (mm <= 0) {
    mm += 12;
    yy -= 1;
  }
  return `${yy}-${String(mm).padStart(2, '0')}`;
}
