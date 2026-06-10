/**
 * Generate the settlement / payout statement (HTML) for seller settlements.
 *
 * Companion to generate-commission-invoices.ts. The statement is the full
 * payout reconciliation (Gross GMV → commission → commission GST → TCS →
 * TDS → net payout) — a remittance advice, NOT a tax invoice. Renders the
 * same document the on-demand endpoints serve, written to:
 *
 *   storage/tax-pdfs/<FY>/<supplierGstin>/SETTLEMENT_STATEMENT/<ref>.html
 *
 * Net mirrors SettlementTds194OHookService.computeNetPayoutInPaise (clamped).
 *
 * USAGE (from apps/api):
 *   npx ts-node prisma/scripts/generate-settlement-statements.ts            # APPROVED+PAID (default)
 *   npx ts-node prisma/scripts/generate-settlement-statements.ts --status=ALL
 *   npx ts-node prisma/scripts/generate-settlement-statements.ts --dry-run
 *   npx ts-node prisma/scripts/generate-settlement-statements.ts --force
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  renderSettlementStatementHtml,
  type SettlementStatementTemplateInput,
} from '../../src/modules/tax/domain/tax-document-html-template';

const prisma = new PrismaClient();
const DOC_DIR = 'SETTLEMENT_STATEMENT';

function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const m = ist.getUTCMonth();
  const y = ist.getUTCFullYear();
  const fyStart = m >= 3 ? y : y - 1;
  return `${fyStart}-${((fyStart + 1) % 100).toString().padStart(2, '0')}`;
}

function normalizeAddress(json: unknown): Prisma.JsonValue | null {
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
  return {
    status: (statusArg?.split('=')[1] ?? 'APPROVED_PAID').toUpperCase(),
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
  if (!platform) throw new Error('No default+active PlatformGstProfile found.');

  const statusFilter =
    status === 'ALL'
      ? {}
      : status === 'APPROVED_PAID'
        ? { status: { in: ['APPROVED', 'PAID'] as never } }
        : { status: status as never };

  const settlements = await prisma.sellerSettlement.findMany({
    where: statusFilter,
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
          bankDetails: {
            select: {
              accountHolderName: true,
              accountNumberLast4: true,
              ifscCode: true,
              bankName: true,
            },
          },
        },
      },
      cycle: {
        select: {
          periodStart: true,
          periodEnd: true,
          approvedAt: true,
          status: true,
        },
      },
      commissionRecords: {
        orderBy: { createdAt: 'asc' },
        select: {
          orderNumber: true,
          productTitle: true,
          quantity: true,
          totalPlatformAmountInPaise: true,
          platformMarginInPaise: true,
          status: true,
          createdAt: true,
        },
      },
      adjustments: {
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { adjustmentType: true, reason: true, amountInPaise: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rootDir = resolve(process.cwd(), 'storage', 'tax-pdfs');
  console.log(
    `Found ${settlements.length} settlement(s) (status filter: ${status})${dryRun ? ' [DRY RUN]' : ''}.`,
  );

  let written = 0;
  let skipped = 0;
  for (const s of settlements) {
    let net =
      s.totalSettlementAmountInPaise -
      s.tcsDeductedInPaise -
      s.tdsDeductedInPaise -
      s.totalCommissionGstInPaise;
    if (net < 0n) net = 0n;

    const statementDate = s.paidAt ?? s.cycle?.approvedAt ?? s.createdAt;
    const fy = financialYearOf(statementDate);
    const supplierGstin = s.commissionInvoiceSupplierGstin ?? platform.gstin;
    const statementRef = `SM-STMT-${s.id.slice(0, 8).toUpperCase()}`;

    const bank = s.seller?.bankDetails;
    const input: SettlementStatementTemplateInput = {
      mode: 'OFF',
      statementRef,
      settlementId: s.id,
      statementDate,
      periodStart: s.cycle?.periodStart ?? null,
      periodEnd: s.cycle?.periodEnd ?? null,
      payoutDate: s.paidAt ?? s.payoutDueBy ?? null,
      status: s.status,
      totalOrders: s.totalOrders,
      totalItems: s.totalItems,
      marketplaceLegalName: platform.legalBusinessName,
      marketplaceGstin: supplierGstin,
      marketplaceStateCode: platform.gstStateCode,
      marketplaceAddressJson: normalizeAddress(platform.registeredAddressJson),
      sellerLegalName: s.seller?.legalBusinessName ?? s.sellerName,
      sellerShopName: s.seller?.sellerShopName ?? null,
      sellerGstin: s.seller?.gstin ?? null,
      sellerPan:
        s.seller?.panNumber ??
        (s.seller?.panLast4 ? `••••${s.seller.panLast4}` : null),
      sellerCode: s.sellerId,
      sellerStateCode: s.seller?.gstStateCode ?? null,
      sellerAddressJson: normalizeAddress(s.seller?.registeredBusinessAddressJson),
      orders: s.commissionRecords.map((r) => ({
        orderNumber: r.orderNumber,
        date: r.createdAt,
        productTitle: r.productTitle,
        quantity: r.quantity,
        grossInPaise: r.totalPlatformAmountInPaise,
        commissionInPaise: r.platformMarginInPaise,
        status: r.status,
      })),
      returnedOrderCount: s.commissionRecords.filter(
        (r) => r.status === 'REFUNDED',
      ).length,
      grossGmvInPaise: s.totalPlatformAmountInPaise,
      commissionInPaise: s.totalPlatformMarginInPaise,
      settlementAmountInPaise: s.totalSettlementAmountInPaise,
      commissionGstInPaise: s.totalCommissionGstInPaise,
      commissionGstSplitType: s.commissionGstSplitType,
      cgstOnCommissionInPaise: s.cgstOnCommissionInPaise,
      sgstOnCommissionInPaise: s.sgstOnCommissionInPaise,
      igstOnCommissionInPaise: s.igstOnCommissionInPaise,
      commissionGstRateBps: s.commissionGstRateBps,
      tcsInPaise: s.tcsDeductedInPaise,
      tcsRateBps: s.tcsRateBpsSnapshot,
      tdsInPaise: s.tdsDeductedInPaise,
      tdsRateBps: s.tdsRateBpsSnapshot,
      netPayoutInPaise: net,
      adjustments: s.adjustments.map((a) => ({
        label: adjustmentLabel(a.adjustmentType),
        reason: a.reason,
        amountInPaise: a.amountInPaise,
      })),
      utrReference: s.utrReference,
      paidAt: s.paidAt,
      paymentMethod: s.paymentMethod,
      bankAccountHolder: bank?.accountHolderName ?? null,
      bankName: bank?.bankName ?? null,
      bankIfsc: bank?.ifscCode ?? null,
      bankAccountLast4: bank?.accountNumberLast4 ?? null,
      commissionInvoiceNumber: s.commissionInvoiceNumber,
    };

    const html = renderSettlementStatementHtml(input);
    const storagePath = `${fy}/${supplierGstin}/${DOC_DIR}/${statementRef}.html`;
    const absPath = join(rootDir, storagePath);

    if (!force && (await fileExists(absPath))) {
      console.log(`  · skip  ${storagePath} (exists; --force to overwrite)`);
      skipped++;
      continue;
    }
    const sha = createHash('sha256').update(html, 'utf-8').digest('hex');
    if (dryRun) {
      console.log(`  · would write ${storagePath} (net=${net} paise, sha256=${sha.slice(0, 12)}…)`);
      continue;
    }
    await fs.mkdir(dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, Buffer.from(html, 'utf-8'));
    written++;
    console.log(`  ✓ wrote ${storagePath} (net=${net} paise, sha256=${sha.slice(0, 12)}…)`);
  }

  console.log(
    `\nDone. ${dryRun ? 'Dry run — nothing written.' : `Written: ${written}`} · Skipped: ${skipped}`,
  );
}

main()
  .catch((err) => {
    console.error('generate-settlement-statements failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
