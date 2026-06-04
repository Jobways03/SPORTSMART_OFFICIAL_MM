/**
 * Seeds 18 admin RBAC system roles into `admin_custom_roles` with their
 * default permission sets. Idempotent — safe to re-run; updates description
 * + permissions in place when the role already exists.
 *
 * Run with: pnpm seed:rbac
 */
import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSION_KEYS,
  PermissionKey,
} from '../../src/core/authorization/permission-registry';

const prisma = new PrismaClient();

interface SystemRoleSeed {
  name: string;
  description: string;
  permissions: PermissionKey[];
}

// Helpers — derive read-only or every-* permission sets from the catalog.
const allReadKeys = ALL_PERMISSION_KEYS.filter((k: PermissionKey) => k.endsWith('.read'));

const SYSTEM_ROLES: SystemRoleSeed[] = [
  {
    name: 'Super Admin',
    description: 'Unrestricted access — manages users, roles, and every module.',
    permissions: [...ALL_PERMISSION_KEYS],
  },
  {
    name: 'Operations Manager',
    description: 'Day-to-day order, return, fulfillment, and exception oversight.',
    permissions: [
      'orders.read', 'orders.cancel',
      'returns.read', 'returns.approve', 'returns.reject',
      'returns.schedulePickup', 'returns.receive',
      'returns.uploadQcEvidence', 'returns.qcDecide', 'returns.close',
      'returns.export',
      'sellerReversals.read', 'sellerReversals.approve',
      'refunds.read', 'refunds.initiate', 'refunds.confirm', 'refunds.retry',
      'paymentOps.read', 'paymentOps.transition',
      'recon.read',
      'audit.read',
      'portal.streams.admin.read',
      'support.read', 'support.assign',
      'analytics.read',
      'customers.read',
    ],
  },
  {
    name: 'Order Executive',
    description: 'Handles flagged orders, reassignments, and basic cancellations.',
    permissions: [
      'orders.read', 'orders.cancel',
      'returns.read',
      'customers.read',
    ],
  },
  {
    name: 'Returns & QC Manager',
    description: 'Approves returns, makes refund decisions, runs QC.',
    permissions: [
      'returns.read', 'returns.approve', 'returns.reject',
      'returns.schedulePickup', 'returns.receive',
      'returns.uploadQcEvidence', 'returns.qcDecide', 'returns.overrideQc',
      'returns.close', 'returns.export',
      'sellerReversals.read', 'sellerReversals.approve',
      'refunds.read', 'refunds.initiate', 'refunds.approve',
      'refunds.confirm', 'refunds.retry', 'refunds.manualConfirm',
      'wallets.read', 'wallets.adjust',
      'logistics.claim',
      'audit.read',
      'orders.read',
    ],
  },
  {
    name: 'Catalog Manager',
    description: 'Manages products, brands, categories, collections, metafields.',
    permissions: [
      'catalog.read', 'catalog.write', 'catalog.approve',
      'products.read', 'products.approve',
      'sellers.read',
      'storefront.read',
      // Phase 249 — product authors can use AI content generation.
      'ai.generate.product',
    ],
  },
  {
    name: 'Seller Onboarding Manager',
    description: 'KYC verification, seller approval, document review.',
    permissions: [
      'sellers.read', 'sellers.approve', 'sellers.suspend',
      'files.read',
      'audit.read',
    ],
  },
  {
    name: 'Seller Success Manager',
    description: 'Seller relationship, performance, settlement visibility.',
    permissions: [
      'sellers.read',
      'settlements.read',
      'payouts.read',
      'support.read', 'support.reply',
      'analytics.read',
    ],
  },
  {
    name: 'Support Executive (T1)',
    description: 'Tier-1 support — answers tickets, basic order/return info.',
    permissions: [
      'support.read', 'support.reply',
      'orders.read',
      'returns.read',
      'notifications.read',
      'customers.read',
    ],
  },
  {
    name: 'Support Lead (T2)',
    description: 'Tier-2 support — escalations, refunds, basic disputes.',
    permissions: [
      'support.read', 'support.reply', 'support.assign', 'support.promoteToDispute',
      'internalNotes.read', 'internalNotes.write',
      'orders.read',
      'returns.read', 'returns.approve', 'returns.reject',
      'refunds.read', 'refunds.initiate',
      'wallets.read', 'wallets.adjust',
      'disputes.read',
      'notifications.read',
      'customers.read',
    ],
  },
  {
    name: 'Disputes Officer',
    description: 'Investigates disputes, decides outcomes, handles fraud cases.',
    permissions: [
      'disputes.read', 'disputes.assign', 'disputes.statusUpdate',
      'disputes.decide', 'disputes.reopen',
      'internalNotes.read', 'internalNotes.write',
      'support.read', 'support.promoteToDispute',
      'wallets.read', 'wallets.adjust', 'wallets.block',
      'refunds.read', 'refunds.initiate', 'refunds.approve',
      'logistics.claim',
      'audit.read',
      'orders.read',
      'customers.read',
    ],
  },
  {
    name: 'Risk / Fraud Analyst',
    description: 'COD rules, fraud review, payment-ops alerts, dispute oversight.',
    permissions: [
      'cod.read', 'cod.write',
      'paymentOps.read', 'paymentOps.transition',
      'risk.review',
      'disputes.read',
      'internalNotes.read', 'internalNotes.write',
      'audit.read',
      // Phase 207 (#1) / Phase 208 (#3) — fraud/risk owns brute-force
      // triage, so this tier carries the access-log spike surface and
      // the unified admin activity timeline.
      'security.read', 'admin.activity.read',
      'orders.read',
      'customers.read', 'customers.suspend',
      // Phase 245 (abuse-detection audit #12) — the coupon-abuse surface
      // belongs to risk, not general marketing. read = PII telemetry +
      // concentration; review = triage; action = suspend coupon / block.
      'discounts.read', 'discounts.abuse.read',
      'discounts.abuse.review', 'discounts.abuse.action',
    ],
  },
  {
    name: 'Accounts Executive',
    description: 'Read-only finance — payouts, settlements, reconciliation.',
    permissions: [
      'payouts.read',
      'settlements.read',
      'recon.read',
      'audit.read',
    ],
  },
  {
    name: 'Finance Manager',
    description: 'Approves settlements, marks paid, runs recon, ingests bank file.',
    permissions: [
      'settlements.read', 'settlements.approve', 'settlements.markPaid',
      'payouts.read', 'payouts.export', 'payouts.ingestResponse',
      'recon.read', 'recon.run', 'recon.transition',
      'paymentOps.read', 'paymentOps.transition',
      'audit.read',
      // Phase 243 #19 / 247 #13 — funding type/split is a finance
      // decision (it shifts settlement money); P&L detail (fundingNotes,
      // liability split) is finance-tier read.
      'discounts.read', 'discounts.read.finance', 'discounts.write.funding',
    ],
  },
  {
    name: 'Affiliate Manager',
    description: 'Affiliate KYC, commission rules, payouts.',
    permissions: [
      'affiliates.read', 'affiliates.approve', 'affiliates.suspend',
      'affiliates.commission', 'affiliates.payouts',
      'payouts.read',
      'audit.read',
    ],
  },
  {
    name: 'Franchise Manager',
    description: 'Franchise KYC, allocation, finance, inventory ledger.',
    permissions: [
      'franchise.read', 'franchise.approve', 'franchise.suspend',
      'franchise.finance', 'franchise.inventory', 'franchise.orders',
      'audit.read',
      'orders.read',
    ],
  },
  // 'Nova / Warehouse Manager' deferred to MVP 2 — own-brand
  // procurement isn't part of MVP 1 scope. Re-enable here when ready.
  {
    name: 'Marketing Manager',
    description: 'Banners, FAQ, CMS pages, navigation, discounts, coupons.',
    permissions: [
      'content.read', 'content.write', 'content.publish',
      'discounts.read', 'discounts.write',
      // Phase 243 #17 / 246 #14 — campaign owners read their own change
      // history and export campaign analytics. Funding/finance + abuse
      // tiers are intentionally NOT here (Finance Manager / Risk roles).
      'discounts.audit', 'discounts.analytics.export',
      'storefront.read', 'storefront.write',
      'analytics.read',
    ],
  },
  {
    name: 'Compliance / Auditor',
    description: 'Read-only oversight across audit + reports. No mutations.',
    permissions: [
      ...allReadKeys,
      'payouts.export',
      'analytics.export',
    ],
  },
  {
    // Owns the full Tax/GST surface and the wallet-adjustments approval
    // queue. Only this role (and Super Admin) carries wallet.adjustment.approve
    // — Phase 13 dual-approval rows route through admins holding this role.
    name: 'Tax & Compliance Manager',
    description:
      'Tax/GST module owner — invoices, credit notes, e-way bills, e-invoices, GSTR reports, TCS, and the wallet-adjustments approval queue.',
    permissions: [
      // Core tax surface
      'tax.read', 'tax.configure', 'tax.gstn.verify',
      'tax.invoice.read', 'tax.invoice.download', 'tax.invoice.regeneratePdf',
      'tax.creditNote.read', 'tax.creditNote.download', 'tax.creditNote.create',
      'tax.creditNote.timebarOverride', 'tax.creditNote.timebarReview',
      'tax.debitNote.create',
      'tax.reports.read', 'tax.reports.export',
      // Phase 163 — org-wide audit-readiness dashboard + the STRICT-mode
      // export blocker-override (HIGH; every use is audit-logged).
      'tax.readiness.read', 'tax.reports.overrideBlockers',
      'tax.tcs.read', 'tax.tcs.compute', 'tax.tcs.export',
      'tax.tcs.markFiled', 'tax.tcs.markPaidToGovt',
      'tax.ewayBill.read', 'tax.ewayBill.generate', 'tax.ewayBill.cancel', 'tax.ewayBill.override',
      'tax.einvoice.manage', 'tax.einvoice.cancelWithinWindow',
      // Phase 161 — §194-O seller exemption (was wrongly gated by tax.gstn.verify).
      'tax.tds194o.exempt',
      'tax.override',
      // Wallet-adjustments approval queue (Phase 13 dual approval lands here)
      'wallet.adjustment.read', 'wallet.adjustment.create',
      'wallet.adjustment.approve', 'wallet.adjustment.reject',
      // Phase 162 — reverse a posted adjustment (compensating entry).
      'wallet.adjustment.reverse',
      // Cross-context reads the queue needs to be useful
      'wallets.read',
      'recon.read',
      'audit.read',
      'orders.read',
      'returns.read',
      'customers.read',
    ],
  },
];

async function main() {
  console.log('--- Admin RBAC Seed Script ---');
  console.log(`Seeding ${SYSTEM_ROLES.length} system roles...`);

  for (const role of SYSTEM_ROLES) {
    const existing = await prisma.adminCustomRole.findUnique({
      where: { name: role.name },
    });

    if (existing) {
      // Role already exists — only refresh the description and isSystem flag.
      // Permissions are NOT overwritten so admin edits made via the Roles UI
      // are preserved. (Re-seeding stays idempotent for fresh installs.)
      await prisma.adminCustomRole.update({
        where: { id: existing.id },
        data: {
          description: role.description,
          isSystem: true,
        },
      });
      console.log(`  ↻ kept     ${role.name}  (existing perms preserved)`);
    } else {
      await prisma.adminCustomRole.create({
        data: {
          name: role.name,
          description: role.description,
          isSystem: true,
          permissions: {
            create: role.permissions.map((permissionKey) => ({ permissionKey })),
          },
        },
      });
      console.log(`  + created  ${role.name}  (${role.permissions.length} perms)`);
    }
  }

  const total = await prisma.adminCustomRole.count({ where: { isSystem: true } });
  console.log(`Done. ${total} system roles in admin_custom_roles.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
