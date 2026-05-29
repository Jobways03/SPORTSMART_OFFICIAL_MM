// Phase 27 IT — Form 26Q TDS quarterly-return export.
//
// Form 26Q is the CBDT quarterly return for non-salary TDS (which
// includes Section 194-O marketplace TDS). The file format admins
// upload to TIN-Protean / NSDL has fixed header columns and one row
// per deductee per challan.
//
// This service emits two shapes:
//   - CSV — human-readable, used for internal review + the admin
//     download. Header order is the canonical one CBDT publishes;
//     downstream tooling that converts to the .txt file format
//     produced by NSDL's RPU utility (Return Preparation Utility)
//     can map directly off these column names.
//   - JSON summary — for the admin UI quarter-level rollup.
//
// Conversion to the actual .txt format NSDL expects (fixed-width
// records, RPU-specific encoding) stays out of scope until ops
// confirms the integration path. Today, ops imports this CSV into
// the RPU manually.

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { Tds194OService } from './tds-194o.service';
// Phase 159g — shared CSV escaper with the formula-injection guard. The local
// csvCell below was RFC-4180-only (no = + - @ guard) — a live injection vuln.
import { escapeCsvField } from '../../../../core/utils/csv.util';
import {
  renderForm16AHtml,
  type Form16AInput,
} from '../../domain/form-16a-template';

// Tds194OService.listForPeriod returns the Prisma `Section194OTdsLedger`
// shape. Imported as `unknown` here to avoid a circular type
// reference; the row shape is structurally compatible.
type LedgerRow = Awaited<
  ReturnType<Tds194OService['listForPeriod']>
>[number];

@Injectable()
export class Form26QReportService {
  private readonly logger = new Logger(Form26QReportService.name);

  // CBDT Form 26Q canonical columns (subset relevant to Section
  // 194-O; the RPU utility accepts additional optional columns
  // that ops fills in at upload time). Order is load-bearing for
  // any downstream tool that mirrors NSDL's column-positional
  // format.
  private static readonly CSV_HEADER = [
    'Deductee PAN',
    'Deductee Name',
    'Section',
    'Filing Period',
    'Gross Amount Paid',
    'TDS Rate (%)',
    'TDS Amount',
    'Challan Reference',
    'Date of Deposit',
    'Form 16A Certificate Number',
    'Status',
  ];

  constructor(
    private readonly tds: Tds194OService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Render the Form 16A HTML certificate for one (deductee, quarter)
   * pair, resolving the marketplace's own TAN/PAN from the platform
   * GST profile. Returns null when the ledger row doesn't exist (the
   * controller maps this to HTTP 404). Idempotent — safe to render
   * repeatedly; the actual certificate-issuance step (markCertificate
   * Issued) is a separate write driven by the admin UI.
   *
   * For non-CERTIFICATE_ISSUED rows the template still renders so
   * admins can preview before stamping; the certificate number on
   * the page shows the persisted value or "(draft)" when blank.
   */
  async renderForm16AHtml(ledgerId: string): Promise<string | null> {
    const row = await (this.prisma as any).section194OTdsLedger.findUnique({
      where: { id: ledgerId },
      include: {
        seller: {
          select: {
            sellerShopName: true,
            sellerName: true,
            legalBusinessName: true,
            registeredBusinessAddressJson: true,
          },
        },
      },
    });
    if (!row) return null;

    // Marketplace identity. We use the default PlatformGstProfile as
    // a proxy for the deductor — production rollouts should add an
    // explicit TAN column on PlatformGstProfile.
    const platform = await (this.prisma as any).platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      select: {
        legalBusinessName: true,
        gstin: true,
        panNumber: true,
        registeredAddressJson: true,
      },
    });

    // Address blob → single-line string for the certificate body.
    const flattenAddress = (j: unknown): string => {
      if (!j || typeof j !== 'object') return '';
      const a = j as Record<string, unknown>;
      return [a.line1, a.line2, a.city, a.state, a.pincode, a.country]
        .filter((v) => typeof v === 'string' && v)
        .join(', ');
    };

    const fyParts = row.filingPeriod.split('-Q');
    const fyStart = parseInt(fyParts[0], 10);
    const financialYear = `${fyStart}-${(fyStart + 1).toString().slice(-2)}`;

    const sellerName =
      row.seller?.legalBusinessName ??
      row.seller?.sellerShopName ??
      row.seller?.sellerName ??
      row.sellerLegalName ??
      'Unknown';

    const input: Form16AInput = {
      deductorName: platform?.legalBusinessName ?? 'Sportsmart',
      deductorTan: 'TAN-PENDING',
      deductorPan: platform?.panNumber ?? null,
      deductorAddress: flattenAddress(platform?.registeredAddressJson),
      deducteeName: sellerName,
      deducteePan: row.sellerPanNumber ?? null,
      deducteePanLast4: row.sellerPanLast4 ?? null,
      section: '194-O',
      filingPeriod: row.filingPeriod,
      financialYear,
      grossAmountPaidInPaise: row.netSaleInPaise,
      tdsRateBps: row.tdsRateBps,
      tdsDeductedInPaise: row.tdsInPaise,
      certificateNumber: row.certificateNumber ?? '(draft)',
      challanReference: row.challanReference ?? null,
      dateOfDeposit: row.depositedAt ?? null,
      dateOfIssue: row.certificateIssuedAt ?? new Date(),
    };
    return renderForm16AHtml(input);
  }

  /**
   * Build the Form 26Q CSV body. Empty quarters produce a header-
   * only file (NIL return — still must be filed per CBDT).
   */
  async generateCsv(filingPeriod: string): Promise<string> {
    // Phase 159g — reject a malformed period instead of silently returning an
    // empty CSV (which an operator could mistake for a NIL return).
    if (!/^\d{4}-Q[1-4]$/.test(filingPeriod)) {
      throw new BadRequestException('filingPeriod must be YYYY-Qn (e.g. 2026-Q1).');
    }
    const rows = await this.tds.listForPeriod(filingPeriod);
    const lines = [Form26QReportService.CSV_HEADER.map((h) => escapeCsvField(h)).join(',')];
    for (const r of rows) {
      // Phase 159g — escapeCsvField adds the formula-injection guard. The
      // highest-risk cell is sellerLegalName (seller-controlled at registration).
      const cells = [
        escapeCsvField(r.sellerPanNumber ?? ''),
        escapeCsvField(r.sellerLegalName ?? ''),
        '194O',
        escapeCsvField(r.filingPeriod),
        paiseToRupees(r.netSaleInPaise),
        (r.tdsRateBps / 100).toFixed(2),
        paiseToRupees(r.tdsInPaise),
        escapeCsvField(r.challanReference ?? ''),
        r.depositedAt ? formatIstDate(r.depositedAt) : '',
        escapeCsvField(r.certificateNumber ?? ''),
        escapeCsvField(r.status),
      ];
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  /**
   * Quarter-level summary for the admin UI. Counts deductees +
   * aggregate gross / total TDS / deposited / certificate-issued
   * tallies so the admin can spot pending workflow steps before
   * the filing deadline.
   */
  async summarise(filingPeriod: string): Promise<{
    filingPeriod: string;
    deducteeCount: number;
    totalGrossInPaise: bigint;
    totalTdsInPaise: bigint;
    depositedCount: number;
    certificateIssuedCount: number;
    rows: LedgerRow[];
  }> {
    const rows = await this.tds.listForPeriod(filingPeriod);
    let totalGrossInPaise = 0n;
    let totalTdsInPaise = 0n;
    let depositedCount = 0;
    let certificateIssuedCount = 0;
    for (const r of rows) {
      totalGrossInPaise += r.netSaleInPaise;
      totalTdsInPaise += r.tdsInPaise;
      if (
        r.status === 'DEPOSITED' ||
        r.status === 'CERTIFICATE_ISSUED'
      ) {
        depositedCount++;
      }
      if (r.status === 'CERTIFICATE_ISSUED') {
        certificateIssuedCount++;
      }
    }
    return {
      filingPeriod,
      deducteeCount: rows.length,
      totalGrossInPaise,
      totalTdsInPaise,
      depositedCount,
      certificateIssuedCount,
      rows,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────
// Phase 159g — the local csvCell was removed in favour of the shared
// core/utils/csv.util escapeCsvField (adds the formula-injection guard).

function paiseToRupees(p: bigint): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const rupees = `${whole.toString()}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${rupees}` : rupees;
}

function formatIstDate(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = ist.getUTCDate().toString().padStart(2, '0');
  const mm = (ist.getUTCMonth() + 1).toString().padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
