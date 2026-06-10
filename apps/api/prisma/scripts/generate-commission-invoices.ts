/**
 * Generate the printable commission settlement invoice (HTML) for seller
 * settlements.
 *
 * Phase 159aa issues the commission invoice as denorm columns on
 * SellerSettlement (number, date, GST split, place of supply, …) at
 * cycle-approval time, but never rendered a document — only product
 * invoices (SM-INV-*) had HTML under storage/tax-pdfs. This script fills
 * that gap: it reads the already-issued invoice snapshots and writes the
 * matching HTML to the SAME storage layout the TaxDocumentPdfService uses
 * for product invoices, so the files sit alongside them:
 *
 *   storage/tax-pdfs/<FY>/<supplierGstin>/COMMISSION_INVOICE/<number>.html
 *
 * Supplier = the marketplace (PlatformGstProfile); recipient = the seller.
 *
 * USAGE (from apps/api):
 *   npx ts-node prisma/scripts/generate-commission-invoices.ts            # PAID settlements (default)
 *   npx ts-node prisma/scripts/generate-commission-invoices.ts --status=ALL
 *   npx ts-node prisma/scripts/generate-commission-invoices.ts --dry-run  # render + report, write nothing
 *   npx ts-node prisma/scripts/generate-commission-invoices.ts --force    # overwrite existing files
 *
 * Idempotent: skips a settlement whose file already exists unless --force.
 * Only settlements that already carry a commissionInvoiceNumber are
 * eligible (the invoice must have been issued at cycle approval first).
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  renderCommissionInvoiceHtml,
  type CommissionInvoiceTemplateInput,
} from '../../src/modules/tax/domain/tax-document-html-template';

const prisma = new PrismaClient();

const DOCUMENT_TYPE_DIR = 'COMMISSION_INVOICE';

/** Indian financial year (Apr–Mar) in IST — mirrors
 *  DocumentSequenceService.financialYearOf so the file lands in the same
 *  FY folder the invoice number was allocated under. */
function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const m = ist.getUTCMonth(); // 0 = Jan
  const y = ist.getUTCFullYear();
  const fyStart = m >= 3 ? y : y - 1;
  const fyEnd = (fyStart + 1) % 100;
  return `${fyStart}-${fyEnd.toString().padStart(2, '0')}`;
}

/** PlatformGstProfile stores `addressLine1/addressLine2`; the seller stores
 *  `line1/line2`. The template's address formatter reads `line1/line2`, so
 *  normalise the platform shape before handing it over. Pass-through for
 *  anything already in the right shape. */
function normalizeAddress(
  json: Prisma.JsonValue | null | undefined,
): Prisma.JsonValue | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  return {
    line1: (o.line1 ?? o.addressLine1 ?? '') as string,
    line2: (o.line2 ?? o.addressLine2 ?? '') as string,
    city: (o.city ?? '') as string,
    state: (o.state ?? '') as string,
    pincode: (o.pincode ?? '') as string,
    country: (o.country ?? '') as string,
  };
}

function adjustmentLabel(type: string): string {
  switch (type) {
    case 'COURIER_PENALTY':
      return 'Logistics Recovery (courier penalty)';
    case 'SLA_FINE':
      return 'SLA Breach Penalty';
    case 'GOODWILL':
      return 'Goodwill Credit';
    case 'MANUAL_CORRECTION':
      return 'Manual Adjustment';
    case 'CLAWBACK':
      return 'Commission Clawback';
    default:
      return 'Other Adjustment';
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const statusArg = args.find((a) => a.startsWith('--status='));
  const status = (statusArg?.split('=')[1] ?? 'PAID').toUpperCase();
  return {
    status, // 'PAID' (default) | 'ALL' | any SellerSettlementStatus
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const { status, dryRun, force } = parseArgs();

  const platform = await prisma.platformGstProfile.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (!platform) {
    throw new Error(
      'No default+active PlatformGstProfile found — cannot stamp the supplier identity on commission invoices.',
    );
  }

  const settlements = await prisma.sellerSettlement.findMany({
    where: {
      commissionInvoiceNumber: { not: null },
      ...(status === 'ALL' ? {} : { status: status as never }),
    },
    include: {
      seller: {
        select: {
          legalBusinessName: true,
          sellerShopName: true,
          gstin: true,
          gstStateCode: true,
          registeredBusinessAddressJson: true,
          panNumber: true,
          panLast4: true,
        },
      },
      cycle: { select: { periodStart: true, periodEnd: true } },
      adjustments: {
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { adjustmentType: true, reason: true, amountInPaise: true },
      },
    },
    orderBy: { commissionInvoiceNumber: 'asc' },
  });

  const rootDir = resolve(process.cwd(), 'storage', 'tax-pdfs');
  console.log(
    `Found ${settlements.length} settlement(s) with an issued commission invoice ` +
      `(status filter: ${status})${dryRun ? ' [DRY RUN]' : ''}.`,
  );

  let written = 0;
  let skipped = 0;
  for (const s of settlements) {
    const number = s.commissionInvoiceNumber!;
    // Invoice date drives the FY folder; fall back to paidAt then now.
    const invoiceDate =
      s.commissionInvoiceDate ?? s.paidAt ?? new Date();
    const fy = financialYearOf(invoiceDate);
    const supplierGstin =
      s.commissionInvoiceSupplierGstin ?? platform.gstin;

    const input: CommissionInvoiceTemplateInput = {
      mode: 'OFF',
      invoiceNumber: number,
      invoiceDate,
      financialYear: fy,
      filingPeriod: s.commissionInvoiceFilingPeriod ?? '',
      sacCode: s.commissionInvoiceSacCode ?? '9985',
      gstRateBps: s.commissionGstRateBps,
      splitType: s.commissionGstSplitType,

      marketplaceLegalName: platform.legalBusinessName,
      marketplaceGstin: supplierGstin,
      marketplacePan: platform.panNumber ?? (platform.panLast4 ? `••••${platform.panLast4}` : null),
      marketplaceStateCode: platform.gstStateCode,
      marketplaceAddressJson: normalizeAddress(platform.registeredAddressJson),

      sellerLegalName: s.seller?.legalBusinessName ?? s.sellerName,
      sellerShopName: s.seller?.sellerShopName ?? null,
      sellerGstin:
        s.commissionInvoiceRecipientGstin ?? s.seller?.gstin ?? null,
      sellerPan:
        s.seller?.panNumber ??
        (s.seller?.panLast4 ? `••••${s.seller.panLast4}` : null),
      sellerIsB2c: s.commissionRecipientIsB2c,
      sellerStateCode: s.seller?.gstStateCode ?? null,
      sellerAddressJson: normalizeAddress(
        s.seller?.registeredBusinessAddressJson,
      ),
      placeOfSupplyStateCode: s.commissionPlaceOfSupplyStateCode ?? '—',

      settlementId: s.id,
      settlementStatementRef: `SM-STMT-${s.id.slice(0, 8).toUpperCase()}`,
      cyclePeriodStart: s.cycle?.periodStart ?? null,
      cyclePeriodEnd: s.cycle?.periodEnd ?? null,
      totalOrders: s.totalOrders,
      totalItems: s.totalItems,
      grossGmvInPaise: s.totalPlatformAmountInPaise,

      commissionTaxableInPaise: s.totalPlatformMarginInPaise,
      cgstInPaise: s.cgstOnCommissionInPaise,
      sgstInPaise: s.sgstOnCommissionInPaise,
      igstInPaise: s.igstOnCommissionInPaise,
      totalGstInPaise: s.totalCommissionGstInPaise,

      adjustments: s.adjustments.map((a) => ({
        label: adjustmentLabel(a.adjustmentType),
        reason: a.reason,
        amountInPaise: a.amountInPaise,
      })),

      irn: s.commissionInvoiceIrn,
    };

    const html = renderCommissionInvoiceHtml(input);
    const safeNumber = number.replace(/[/\\]/g, '-');
    const storagePath = `${fy}/${supplierGstin}/${DOCUMENT_TYPE_DIR}/${safeNumber}.html`;
    const absPath = join(rootDir, storagePath);

    if (!force && (await fileExists(absPath))) {
      console.log(`  · skip  ${storagePath} (exists; pass --force to overwrite)`);
      skipped++;
      continue;
    }

    const sha = createHash('sha256').update(html, 'utf-8').digest('hex');
    if (dryRun) {
      console.log(
        `  · would write ${storagePath} (${Buffer.byteLength(html)} bytes, sha256=${sha.slice(0, 12)}…)`,
      );
      continue;
    }

    await fs.mkdir(dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, Buffer.from(html, 'utf-8'));
    written++;
    console.log(
      `  ✓ wrote ${storagePath} (${Buffer.byteLength(html)} bytes, sha256=${sha.slice(0, 12)}…)`,
    );
  }

  console.log(
    `\nDone. ${dryRun ? 'Dry run — nothing written.' : `Written: ${written}`}` +
      ` · Skipped (already existed): ${skipped}`,
  );
}

main()
  .catch((err) => {
    console.error('generate-commission-invoices failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
