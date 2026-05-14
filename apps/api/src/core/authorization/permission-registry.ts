/**
 * Code-side enumeration of all permission keys. Adding a key here is
 * the source of truth — admin UI lists exactly these for assignment.
 *
 * Convention: <module>.<verb> in lowercase. Verbs follow CRUD where
 * possible (read/create/update/delete) plus action verbs (approve,
 * decide, block, unblock, retry, override).
 *
 * Phase 4 (PR 4.1) of the Returns + Disputes redesign:
 *   - Coarse "returns.decide" replaced with per-stage permissions so
 *     a tier-1 agent can approve/schedule but cannot move money.
 *   - Refund actions ("refunds.*") split out from "returns.*" so the
 *     ABAC layer in PR 4.3 can amount-cap them independently.
 *   - Disputes split into read / assign / status / decide / reopen /
 *     override, matching the strict FSM in Phase 5.
 *   - Support adds promoteToDispute, internalNotes.read/write, and
 *     reply/assign.
 *   - Seller/risk/audit/logistics/internalNotes added for the
 *     liability-and-recovery flows in Phase 5.
 *   - Catalog / customers / content / discounts / nova / storefront /
 *     analytics / affiliates / franchise added for the full admin
 *     surface (read-only and write-tier roles).
 *
 * Phase 4 (PR 4.6) — relocated from modules/admin to core/authorization
 * so AdminAuthGuard (which lives in /core/guards) can resolve permissions
 * without a /core → /modules import that would violate ADR-001.
 */
export const PERMISSIONS = {
  // Wallets
  'wallets.read':           'View wallet balances + history',
  'wallets.adjust':         'Manually credit/debit wallets',
  'wallets.block':          'Block/unblock wallets',

  // Returns — granular per stage so tier-1 / tier-2 / finance can split duties
  'returns.read':           'View returns',
  'returns.approve':        'Approve a return request',
  'returns.reject':         'Reject a return request pre-pickup',
  'returns.schedulePickup': 'Schedule the courier pickup',
  'returns.receive':        'Mark return as received at warehouse',
  'returns.uploadQcEvidence': 'Upload QC evidence images',
  'returns.qcDecide':       'Submit QC decision (approve / partial / reject)',
  'returns.overrideQc':     'Override an existing QC decision',
  'returns.close':          'Close / re-open a return',

  // Refunds — separated from returns so admin tiers can be capped by amount
  'refunds.read':           'View refund instructions + transactions',
  'refunds.initiate':       'Create a refund instruction',
  'refunds.approve':        'Approve refund (high-value or risk-flagged)',
  'refunds.confirm':        'Confirm a manual refund (UTR / bank reference)',
  'refunds.retry':          'Retry a failed gateway refund',
  'refunds.manualConfirm':  'Mark a manual / COD refund as paid',

  // Disputes — strict FSM in Phase 5; one permission per transition
  'disputes.read':          'View disputes',
  'disputes.assign':        'Assign disputes to reviewers',
  'disputes.statusUpdate':  'Move dispute through standard FSM steps',
  'disputes.decide':        'Issue dispute decisions (incl refund amount)',
  'disputes.reopen':        'Reopen a resolved / closed dispute',
  'disputes.override':      'Break-glass override of FSM rules',

  // refunds.approve — already declared above; Phase 12 (ADR-017)
  // repurposes it as the finance approval gate for dispute-driven
  // refunds. Same key, broader semantics.

  // Support — promotion + reply granularity
  'support.read':           'View support tickets',
  'support.assign':         'Assign tickets + change priority/status',
  'support.reply':          'Reply on tickets (incl internal notes)',
  'support.promoteToDispute': 'Convert a ticket into a dispute (binding decision)',

  // Internal notes — admin-only annotations on disputes / tickets
  'internalNotes.read':     'View admin-only internal notes',
  'internalNotes.write':    'Author internal notes',

  // Sellers — onboarding + lifecycle + penalty
  'sellers.read':           'View seller list + profile',
  'sellers.approve':        'Approve seller onboarding',
  'sellers.suspend':        'Suspend / activate sellers',
  'sellers.penalize':       'Record financial penalty against a seller',

  // Logistics
  'logistics.claim':        'File / manage logistics damage / loss claims',

  // Risk
  'risk.review':            'Review risk-flagged cases (returns + disputes + customers)',

  // Settlements
  'settlements.read':       'View settlement runs + statements',
  'settlements.approve':    'Approve a settlement cycle',
  'settlements.markPaid':   'Record UTR / mark as paid',

  // Payouts
  'payouts.read':           'View payout batches',
  'payouts.export':         'Generate bank export file',
  'payouts.ingestResponse': 'Upload bank response CSV',

  // Reconciliation
  'recon.read':             'View reconciliation runs',
  'recon.run':              'Trigger a manual reconciliation run',
  'recon.transition':       'Resolve / ignore discrepancies',

  // Payment ops
  'paymentOps.read':        'View alerts + attempts',
  'paymentOps.transition':  'Resolve / ignore alerts',

  // Products
  'products.read':          'View catalog',
  'products.approve':       'Approve product moderation',

  // Orders
  'orders.read':            'View orders',
  'orders.cancel':          'Cancel orders (admin override)',

  // COD
  'cod.read':               'View COD rules + decisions',
  'cod.write':              'Create / edit COD rules',

  // Roles
  'roles.read':             'View roles + permissions',
  'roles.write':            'Create / edit roles + assign permissions',

  // Audit
  'audit.read':             'View + export audit log',

  // Sessions — Story 6.3 admin session-revocation surface. Read lists
  // active refresh-token sessions across actor tables; revoke flips
  // revokedAt so the next refresh request fails closed.
  'sessions.read':          'View active sessions across actors',
  'sessions.revoke':        'Force-logout any session',

  // Notifications
  'notifications.read':     'View notification logs + templates',
  'notifications.write':    'Edit templates + retry notifications',

  // Files
  'files.read':             'View file metadata across actors',
  'files.delete':           'Delete files',

  // Affiliates
  'affiliates.read':        'View affiliate accounts + KYC',
  'affiliates.approve':     'Approve / reject affiliate signups + KYC',
  'affiliates.suspend':     'Suspend / reactivate affiliates',
  'affiliates.commission':  'Edit commission rates + holds',
  'affiliates.payouts':     'Approve / mark-paid affiliate payouts',

  // Franchise
  'franchise.read':         'View franchise list + profile',
  'franchise.approve':      'Approve franchise onboarding + verification',
  'franchise.suspend':      'Suspend / reactivate franchises',
  'franchise.finance':      'Adjustments + penalties on franchise ledger',
  'franchise.inventory':    'View franchise inventory + ledger',
  'franchise.orders':       'Manage franchise sub-orders',

  // Content (banners, FAQ, CMS pages)
  'content.read':           'View banners, FAQ, CMS pages',
  'content.write':          'Edit banners, FAQ, CMS pages',
  'content.publish':        'Publish content live',

  // Discounts / coupons
  'discounts.read':         'View discounts + coupons',
  'discounts.write':        'Create / edit discounts + coupons',

  // Shipping options (v1)
  'shipping.read':          'View shipping options',
  'shipping.write':         'Create / edit shipping options',

  // Nova / own-brand warehouse
  'nova.read':              'View Nova warehouses, products, stock',
  'nova.write':             'Edit Nova warehouses + products',
  'nova.procurement':       'Create / receive Nova procurement',
  'nova.stock':             'Adjust Nova stock + view movements',

  // Customers
  'customers.read':         'View customer list + profile',
  'customers.suspend':      'Suspend / reactivate customers',
  'customers.impersonate':  'Impersonate customer (read-only session)',

  // Catalog (categories, brands, metafields, collections)
  'catalog.read':           'View categories, brands, metafields, collections',
  'catalog.write':          'Edit categories, brands, metafields, collections',
  'catalog.approve':        'Approve seller catalog mappings',

  // Storefront menu / filters
  'storefront.read':        'View storefront menus + filters',
  'storefront.write':       'Edit storefront menus + filters',

  // Analytics
  'analytics.read':         'View analytics dashboards',
  'analytics.export':       'Export analytics CSV',

  // ─── Tax / GST / Invoice / Credit Note / E-way Bill / TCS ──────
  // Phase 1 of the GST/tax/invoice system (2026-05-13). See
  // docs/tax/CA.md and the 27-phase plan. New tax permissions are
  // added to SUPER_ADMIN via ALL_PERMISSION_KEYS (catch-all); other
  // role-specific grants land in Phase 12 (RBAC + audit).
  'tax.read':                       'View tax config + HSN/UQC/state masters',
  'tax.configure':                  'Edit HSN / UQC / GST rates / shipping SAC / tax_config',
  'tax.gstin.verify':               'Verify seller/customer GSTIN (mark isGstVerified)',
  'tax.invoice.read':               'View tax invoices + Bills of Supply',
  'tax.invoice.download':           'Download invoice PDFs',
  'tax.invoice.regeneratePdf':      'Regenerate invoice PDF after template change',
  'tax.creditNote.read':            'View credit notes',
  'tax.creditNote.download':        'Download credit note PDFs',
  'tax.creditNote.create':          'Manually create a credit note (admin override path)',
  'tax.creditNote.timebarOverride': 'Approve credit note past Section 34 window (finance only)',
  'tax.creditNote.timebarReview':   'Review time-barred returns for finance booking',
  'tax.debitNote.create':           'Create debit note (upward price correction, admin only)',
  'tax.reports.read':               'View tax reports (invoice register, HSN summary, etc.)',
  'tax.reports.export':             'Export GSTR-1 / 3B / 8 / TCS / HSN CSV',
  'tax.tcs.read':                   'View TCS ledger + GSTR-8 status',
  'tax.tcs.compute':                'Manually trigger TCS computation',
  'tax.tcs.export':                 'Generate GSTR-8 CSV/JSON',
  'tax.tcs.markFiled':              'Mark TCS rows as FILED post-GSTR-8 submission',
  'tax.tcs.markPaidToGovt':         'Mark TCS rows as PAID_TO_GOVT post remittance',
  'tax.ewayBill.read':              'View e-way bills',
  'tax.ewayBill.generate':          'Trigger e-way bill generation',
  'tax.ewayBill.cancel':            'Cancel e-way bill (within 24h)',
  'tax.ewayBill.override':          'Allow ship without e-way bill (audited)',
  'tax.einvoice.manage':            'Manage e-invoice / IRN settings',
  'tax.einvoice.cancelWithinWindow': 'Cancel IRN via IRP within 24h',
  'tax.override':                   'Approve product / invoice with missing tax data',

  // Wallet adjustments (goodwill, support, time-barred refunds)
  'wallet.adjustment.read':         'View wallet adjustments + goodwill ledger',
  'wallet.adjustment.create':       'Create wallet adjustment (small amounts)',
  'wallet.adjustment.approve':      'Approve high-value wallet adjustments (above threshold)',
  'wallet.adjustment.reject':       'Reject a pending wallet adjustment',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/**
 * Risk classification per permission. Used by the readiness endpoint
 * to surface high-risk permissions that should be flagged for ABAC
 * or MFA gating. Defaults to LOW where not declared.
 *
 * CRITICAL — moves money or grants persistent access to money flows.
 * HIGH     — non-money but high-blast-radius (suspend, approve, override).
 * MEDIUM   — write actions on operational data.
 * LOW      — read-only access.
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const PERMISSION_RISK: Partial<Record<PermissionKey, RiskLevel>> = {
  'wallets.adjust':         'CRITICAL',
  'wallets.block':          'HIGH',
  'refunds.initiate':       'CRITICAL',
  'refunds.approve':        'CRITICAL',
  'refunds.confirm':        'CRITICAL',
  'refunds.manualConfirm':  'CRITICAL',
  'refunds.retry':          'HIGH',
  'disputes.decide':        'CRITICAL',
  'disputes.override':      'CRITICAL',
  'disputes.reopen':        'HIGH',
  'returns.overrideQc':     'HIGH',
  'returns.qcDecide':       'HIGH',
  'returns.approve':        'MEDIUM',
  'returns.reject':         'MEDIUM',
  'settlements.approve':    'CRITICAL',
  'settlements.markPaid':   'CRITICAL',
  'sellers.suspend':        'HIGH',
  'sellers.penalize':       'HIGH',
  'sellers.approve':        'HIGH',
  'customers.suspend':      'HIGH',
  'customers.impersonate':  'CRITICAL',
  'franchise.suspend':      'HIGH',
  'franchise.finance':      'CRITICAL',
  'affiliates.commission':  'HIGH',
  'affiliates.payouts':     'CRITICAL',
  'discounts.write':        'MEDIUM',
  'roles.write':            'CRITICAL',
  'files.delete':           'MEDIUM',
  'content.publish':        'MEDIUM',
  'support.promoteToDispute': 'HIGH',
  'nova.stock':             'MEDIUM',
  'cod.write':              'MEDIUM',
  'payouts.export':         'HIGH',
  'payouts.ingestResponse': 'HIGH',
  'recon.transition':       'MEDIUM',

  // Tax / GST / Invoice — high-risk classifications
  'tax.invoice.regeneratePdf':      'HIGH',
  'tax.creditNote.create':          'CRITICAL',
  'tax.creditNote.timebarOverride': 'CRITICAL',
  'tax.debitNote.create':           'CRITICAL',
  'tax.ewayBill.override':          'HIGH',
  'tax.tcs.markFiled':              'HIGH',
  'tax.tcs.markPaidToGovt':         'HIGH',
  'tax.override':                   'CRITICAL',
  'tax.configure':                  'HIGH',
  'wallet.adjustment.create':       'MEDIUM',
  'wallet.adjustment.approve':      'HIGH',
  'sessions.revoke':        'HIGH',
};

/**
 * Default permission grant per system role. Used by the seeder + by
 * the resolver when an admin's role enum value isn't in any custom Role.
 *
 * Note: the legacy 'returns.decide' coarse permission was replaced by
 * the granular returns.* + refunds.* set. Existing role assignments in
 * the DB referencing 'returns.decide' will continue to work at runtime
 * (we still accept it as a string match on /admin/returns/* legacy
 * routes) but new role definitions should use the granular form.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<string, readonly PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  SELLER_OPERATIONS: [
    'wallets.read', 'wallets.adjust', 'wallets.block',
    'disputes.read', 'disputes.assign', 'disputes.statusUpdate', 'disputes.decide',
    'settlements.read', 'settlements.approve', 'settlements.markPaid',
    'payouts.read', 'payouts.export', 'payouts.ingestResponse',
    'recon.read', 'recon.run', 'recon.transition',
    'paymentOps.read', 'paymentOps.transition',
    'orders.read', 'orders.cancel',
    'returns.read', 'returns.approve', 'returns.reject',
    'returns.schedulePickup', 'returns.receive',
    'returns.uploadQcEvidence', 'returns.qcDecide', 'returns.close',
    'refunds.read', 'refunds.initiate', 'refunds.confirm', 'refunds.retry',
    'cod.read', 'cod.write', 'audit.read', 'files.read',
    'support.read', 'support.assign', 'support.reply', 'support.promoteToDispute',
    'internalNotes.read', 'internalNotes.write',
    'logistics.claim',
    'customers.read', 'analytics.read',
  ],
  SELLER_ADMIN: [
    'sellers.read', 'sellers.approve', 'sellers.suspend', 'sellers.penalize',
    'products.read', 'products.approve',
    'orders.read', 'returns.read',
    'catalog.read', 'catalog.write', 'catalog.approve',
    'analytics.read',
  ],
  SELLER_SUPPORT: [
    'wallets.read', 'disputes.read',
    'orders.read', 'returns.read', 'paymentOps.read',
    'notifications.read',
    'support.read', 'support.reply',
    'customers.read',
  ],
  AFFILIATE_ADMIN: [
    'sellers.read', 'orders.read', 'audit.read',
    'affiliates.read', 'affiliates.approve', 'affiliates.suspend',
    'affiliates.commission', 'affiliates.payouts',
  ],
};
