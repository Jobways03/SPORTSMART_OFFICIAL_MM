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
  // Phase 105 (2026-05-23) — Phase 103 audit Gap #12 closure. Re-open
  // is NOT a thing; the only path out of COMPLETED is via the dispute
  // module (DISPUTE_OVERTURNED / DISPUTE_PARTIAL_OVERRIDE). Description
  // updated to reflect reality.
  'returns.close':          'Close a terminal return (REFUNDED / QC_REJECTED / REFUND_FAILED → COMPLETED)',
  // Phase 107 (2026-05-25) — bulk CSV export carries customer PII (name +
  // email) for up to 50k returns, so it is gated separately from the
  // single-return `returns.read` view (which tier-1 support holds). Granting
  // export ⇒ a deliberate decision to allow a platform-wide PII extract.
  'returns.export':         'Bulk-export returns to CSV (incl. customer PII)',
  // Phase 108 (2026-05-25) — admin approval of seller B2B/off-platform
  // reversals. Approval applies stock + commission reversal + settlement
  // debit, so it is a distinct, higher-trust grant than viewing returns.
  'sellerReversals.read':    'View seller off-platform reversal requests',
  'sellerReversals.approve': 'Approve / reject seller off-platform reversals',

  // Refunds — separated from returns so admin tiers can be capped by amount
  'refunds.read':           'View refund instructions + transactions',
  'refunds.initiate':       'Create a refund instruction',
  'refunds.approve':        'Approve refund (high-value or risk-flagged)',
  'refunds.reject':         'Reject a refund (halts disbursement; reverses liability)',
  'refunds.confirm':        'Confirm a manual refund (UTR / bank reference)',
  'refunds.retry':          'Retry a failed gateway refund',
  'refunds.manualConfirm':  'Mark a manual / COD refund as paid',
  // Phase 105 (2026-05-23) — Phase 102 audit Gap #8 closure. Granular
  // separation from refunds.retry: marking a refund failed manually
  // is a heavier decision (it auto-escalates to REFUND_FAILED at the
  // cap, sends the customer an "our team is on it" email, mirrors
  // failure on the linked RefundInstruction). Permitting only ops
  // leads who own the full refund lifecycle, not every retry-capable
  // admin.
  'refunds.markFailed':     'Mark a refund as failed (manual ops decision)',

  // Disputes — strict FSM in Phase 5; one permission per transition
  'disputes.read':          'View disputes',
  // Phase 0 / H24 — distinct write scope. `disputes.read` was being
  // re-used on POST /admin/disputes/:id/messages which let a
  // read-only support analyst reply on the thread.
  'disputes.reply':         'Reply to a dispute thread (customer-visible)',
  'disputes.internalNote':  'Post internal (admin-only) notes on a dispute',
  'disputes.assign':        'Assign disputes to reviewers',
  'disputes.statusUpdate':  'Move dispute through standard FSM steps',
  'disputes.decide':        'Issue dispute decisions (incl refund amount)',
  'disputes.decide.high_value': 'Decide disputes above the high-value amount threshold',
  'disputes.reopen':        'Reopen a resolved / closed dispute',
  'disputes.override':      'Break-glass override of FSM rules',

  // refunds.approve — already declared above; Phase 12 (ADR-017)
  // repurposes it as the finance approval gate for dispute-driven
  // refunds. Same key, broader semantics.

  // Support — promotion + reply granularity
  'support.read':           'View support tickets',
  'support.assign':         'Assign tickets to admins',
  'support.setStatus':      'Change a ticket status',
  'support.setPriority':    'Change a ticket priority',
  'support.categoriesManage': 'Create / edit / delete ticket categories',
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
  'settlements.history.read': 'View a commission record full audit timeline (internal notes / reasons)',
  'settlements.createCycle': 'Create / cancel a settlement cycle (locks commission records)',
  'settlements.adjust':     'Record / void a settlement adjustment (penalty / fine / goodwill)',
  'settlements.approve':    'Approve a settlement cycle',
  'settlements.markPaid':   'Record UTR / mark as paid',
  'settlements.hold':       'Hold / resume a commission record (fraud / review)',
  'settlements.adjustRecord': 'Adjust a single commission record (dispute resolution)',

  // Liability ledger (Phase 150) — seller-debit claw-back lifecycle.
  'liability_ledger.read':   'View seller-debit ledger + pending-claw-back summary',
  'liability_ledger.write':  'Create a manual seller debit (goodwill / off-platform claw-back)',
  'liability_ledger.cancel': 'Cancel a PENDING seller debit (seller successfully contested)',

  // Payouts
  'payouts.read':           'View payout batches',
  'payouts.export':         'Generate bank export file',
  'payouts.ingestResponse': 'Upload bank response CSV',
  // Phase 151 — abort a DRAFT/EXPORTED batch (releases the settlement lock).
  'payouts.cancel':         'Cancel a payout batch created in error',

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
  /// Phase 24 (2026-05-20) — reassign sub-order to a different seller
  /// (admin-dashboard.controller `POST /orders/:subOrderId/reassign`).
  'orders.write':           'Reassign / mutate orders (admin override)',
  /// Phase 26 (2026-05-20) — SUPER_ADMIN-only force-release of a
  /// verification-queue claim held by another admin. Distinct key
  /// from orders.cancel because the blast radius is different — it
  /// unblocks the queue, doesn't terminate the order — and we want
  /// it CRITICAL-tagged for step-up + audit.
  'orders.forceRelease':    'Force-release a held verification claim',
  /// Phase 68 (2026-05-22) — dedicated verifier permission set
  /// (audit Gaps #3 + #6 + #14). Pre-Phase-68 the verify endpoint
  /// on admin-orders reused `orders.cancel`, and the queue
  /// controller only required class-level `orders.read` — any
  /// authenticated admin (e.g. blog author) could approve / reject
  /// / claim / rescore an order. The three new keys split the
  /// surface:
  ///   orders.verify         — claim, approve, reject (single order)
  ///   orders.verify.bulk    — sweep GREEN orders in one call (HIGH risk)
  ///   orders.verify.rescore — flip an order's risk band (audited)
  'orders.verify':          'Verify placed orders (claim / approve / reject)',
  'orders.verify.bulk':     'Bulk-approve GREEN-banded orders in one sweep',
  'orders.verify.rescore':  'Re-run risk scoring on a placed order',
  /// Phase 74 (2026-05-22) — dedicated reject permission. Pre-Phase-74
  /// reject reused `orders.cancel` which conflated "customer cancel"
  /// and "verifier reject" responsibilities. Splitting them lets ops
  /// grant a verifier reject-only rights without exposing the
  /// admin-side cancellation surface (which has different post-flow
  /// implications around refunds and seller notifications).
  'orders.reject':          'Reject placed orders (cancel + refund prepaid)',
  /// Phase 78 (2026-05-22) — dedicated reassign permission. Pre-Phase-78
  /// reassign reused `orders.cancel`, conflating "kill the order" with
  /// "move the order to a different fulfillment node." Different
  /// operational concerns: cancel is destructive; reassign is a
  /// re-route. Splitting lets ops grant a routing-ops admin reassign
  /// rights without giving them cancellation power.
  ///
  /// `orders.reassign.force` is the gate for ACCEPTED+UNFULFILLED
  /// reassignment (e.g. seller went offline mid-pack). HIGH risk
  /// because it rolls back an already-accepted commitment.
  'orders.reassign':        'Reassign sub-orders to a different fulfillment node',
  'orders.reassign.force':  'Reassign a sub-order that is already ACCEPTED (force override)',
  /// Phase 81 (2026-05-22) — dedicated per-sub-order cancel permission.
  /// Pre-Phase-81 the mid-flow sub-order cancel endpoint reused
  /// `orders.cancel`, which also gates master-order cancellation and
  /// admin reject. Different operational impact (one sub-order vs
  /// whole order vs verification reject), so we split them.
  ///
  /// `orders.subOrder.cancel.force` allows cancelling SHIPPED /
  /// FULFILLED sub-orders. HIGH risk because the goods are already in
  /// transit and the courier needs to be coordinated.
  'orders.subOrder.cancel':       'Cancel a single sub-order mid-flow (releases stock, refunds prepaid)',
  'orders.subOrder.cancel.force': 'Cancel a SHIPPED/FULFILLED sub-order (requires courier coordination)',
  /// Phase 87 (2026-05-23) — NDR/RTO Gap #14/#24. Force-RTO is the
  /// admin override that pushes a stuck NDR'd sub-order into RTO
  /// ahead of the carrier's automatic conversion. HIGH risk —
  /// triggers refund saga + stock restore + commission reversal —
  /// so it sits behind its own permission, audited on every use.
  'orders.rto.force':             'Force a sub-order into RTO ahead of the carrier\'s automatic conversion',
  /// Phase 88 (2026-05-23) — Shipment Evidence audit Gap #15. Tiered
  /// permissions so a read-only support agent cannot soft-delete
  /// evidence, and an ops admin cannot bypass the post-SHIPPED freeze.
  /// `shipment.evidence.read` is the lightest tier — same level as
  /// `returns.read`. `shipment.evidence.write` is for admin-override
  /// upload (when seller portal is unreachable). `shipment.evidence.delete`
  /// is senior-ops because it can override the freeze + permanently
  /// hide a row from disputes (audit row still preserves the action).
  'shipment.evidence.read':       'View shipment evidence (packing photos, POD, RTO proof)',
  'shipment.evidence.write':      'Upload admin-override shipment evidence',
  'shipment.evidence.delete':     'Soft-delete shipment evidence (bypasses post-SHIPPED freeze)',
  /// Phase 83 (2026-05-23) — dedicated deliver permission. Pre-Phase-83
  /// the manual /deliver endpoint reused `orders.cancel`. Granting a
  /// customer-support admin manual-deliver rights pulled in cancel +
  /// reject + reassign as side effects (the same key gates all four).
  /// Splitting them lets ops grant deliver-only access to a tier that
  /// can fix mis-tracked shipments without granting cancel power.
  'orders.deliver':               'Mark sub-orders as delivered (manual override of courier webhook)',
  /// Phase 85 (2026-05-23) — dedicated manual-AWB permission.
  /// Pre-Phase-85 the admin AWB attachment endpoint reused
  /// `shipping.write` (intended for ShippingOption config), so any
  /// admin with shipping-option edit rights could also override
  /// seller-attached AWBs on live orders. Split so this remains a
  /// supervised-tier operation.
  'orders.ship.manual':           'Attach courier name + AWB to a sub-order (admin override)',
  /// Phase 72 (2026-05-22) — Phase 71 risk audit Gap #12. Tune
  /// per-rule weights/thresholds via OrderRiskRuleConfig. Treated
  /// as HIGH-risk because bumping a rule's scoreDelta can flip
  /// orders out of RED and into bulk-approve eligibility.
  'orders.verify.tune_rules': 'Edit risk-scoring rule weights and thresholds',

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
  // Phase 158 — dedicated key for coupon config (discount type/value, caps,
  // schedule). Split out of the broad affiliates.commission since it moves
  // customer-facing money.
  'affiliates.coupons.configure': 'Edit affiliate coupon discount, caps + schedule',
  // Phase 159b — create additional (campaign) coupon codes for an affiliate.
  'affiliates.coupons.create': 'Create additional affiliate coupon codes',
  // Phase 159e — read the §194-O quarterly TDS report (Form 26Q). Read-only;
  // separate from payout execution so a finance/tax role can be granted it.
  'affiliates.tax_report.read': 'View affiliate §194-O TDS reports (Form 26Q)',
  // Phase 159f — TDS deposit + Form 16A issuance lifecycle ops.
  'affiliates.tax.deposit': 'Mark affiliate §194-O TDS deposited (challan)',
  'affiliates.tax.issue_certificate': 'Issue affiliate Form 16A certificates',
  'affiliates.payouts':     'Approve / mark-paid affiliate payouts',
  // Phase 155 — granular split so the 4-eyes principle is enforceable by role
  // (approver ≠ payer). A holder of the broad affiliates.payouts keeps access.
  'affiliates.payouts.approve':    'Approve an affiliate payout request',
  'affiliates.payouts.reject':     'Reject an affiliate payout request',
  'affiliates.payouts.mark_paid':  'Mark an affiliate payout PAID (records the UTR)',
  'affiliates.payouts.mark_failed':'Mark an affiliate payout FAILED',

  // Franchise
  'franchise.read':         'View franchise list + profile',
  'franchise.approve':      'Approve franchise onboarding + verification',
  'franchise.suspend':      'Suspend / reactivate franchises',
  'franchise.finance':      'Adjustments + penalties on franchise ledger',
  'franchise.inventory':    'View franchise inventory + ledger',
  'franchise.orders':       'Manage franchise sub-orders',
  'franchise.procurement_pricing': 'Set per-franchise procurement cost overrides',
  'franchise.pincodes.read':  'View a franchise pincode coverage map',
  'franchise.pincodes.write': 'Assign / remove franchise pincode coverage',
  'franchise.catalog.approve': 'Approve / reject / stop franchise catalog mappings',
  'franchise.procurement.approve': 'Approve / reject a franchise procurement request (sets landed cost + payable)',
  'franchise.procurement.dispatch': 'Mark a franchise procurement request dispatched',
  'franchise.procurement.settle': 'Settle a received franchise procurement request (posts the finance ledger)',
  'franchise.pos.report.read': "Read a franchise's daily POS sales report (revenue)",

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
  /// Phase 23 (2026-05-20) — edit customer details + unlock locked
  /// accounts (admin-customers.controller `POST /:id/unlock`).
  'customers.update':       'Edit customer details + unlock locked accounts',
  'customers.suspend':      'Suspend / reactivate customers',
  'customers.impersonate':  'Impersonate customer (read-only session)',

  // Catalog (categories, brands, metafields, collections)
  'catalog.read':           'View categories, brands, metafields, collections',
  'catalog.write':          'Edit categories, brands, metafields, collections',
  'catalog.approve':        'Approve seller catalog mappings',

  // Phase 53 (2026-05-21) — inventory adjust. Gates the new admin
  // POST /admin/inventory/mappings/:id/adjust-stock endpoint. Sellers
  // adjust via SellerAuthGuard, franchises via their own guard — this
  // key is admin-only.
  'inventory.adjust':       'Adjust seller/franchise stock with mandatory reason',
  'inventory.adjust.write_off': 'Permanent write-off — higher tier signoff',

  // Phase 54 (2026-05-21) — low-stock alerts. Replaces the generic
  // nova.read previously used for the admin alerts controller so
  // ops-only roles (without broad nova read) can still triage low
  // stock without seeing every other admin surface.
  'inventory.alerts.read':    'View low-stock alerts list',
  'inventory.alerts.sweep':   'Trigger on-demand low-stock sweep',
  'inventory.alerts.dismiss': 'Dismiss / snooze / resolve low-stock alerts',

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
  // Phase 37 (Round 12-15) — master-data admin pages
  // (/admin/tax/{hsn,uqc,config,platform-gst}) declared these keys
  // but the registry never carried them. In strict mode the guard
  // would 403 every call. Phase 0 (Gap audit) added them.
  'tax.master.read':                'View HSN / UQC / TaxConfig / Platform GST profile masters',
  'tax.master.write':               'Edit HSN / UQC / TaxConfig / Platform GST profile masters',
  // Phase 0 (Gap audit) — controller decorator uses `tax.gstn.verify`;
  // the registry previously had `tax.gstin.verify` (extra "i") so
  // every call to admin-tax-operations 403'd in strict mode. Renamed
  // to match the controller. If any existing role row still has the
  // old key, drop it via `pnpm seed:rbac --reseed`.
  'tax.gstn.verify':                'Verify seller/customer GSTIN against the GSTN portal (mark isGstVerified)',
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
  // Phase 159z (GSTR-8 audit #10) — separate permission for the
  // correction flow (REVERSED transition). Highest gating tier
  // because reversal undoes a filed return.
  'tax.tcs.reverse':                'Reverse a TCS ledger row (GSTR-8 correction flow)',
  'tax.ewayBill.read':              'View e-way bills',
  'tax.ewayBill.generate':          'Trigger e-way bill generation',
  'tax.ewayBill.cancel':            'Cancel e-way bill (within 24h)',
  'tax.ewayBill.override':          'Allow ship without e-way bill (audited)',
  'tax.einvoice.manage':            'Manage e-invoice / IRN settings',
  'tax.einvoice.cancelWithinWindow': 'Cancel IRN via IRP within 24h',
  'tax.override':                   'Approve product / invoice with missing tax data',
  // Phase 46 (2026-05-21) — bulk tax-config gates. These are
  // intentionally NOT included in any role-specific set in
  // SYSTEM_ROLE_PERMISSIONS below. SUPER_ADMIN receives them via the
  // ALL_PERMISSION_KEYS catch-all. To grant to another role, add
  // the key explicitly to that role's permission array.
  //
  // tax.bulk-config:  bulk-update HSN / rate / supply taxability /
  //                   UQC / cess across products. Resets each
  //                   touched row's taxConfigVerified flag so a
  //                   follow-up attestation is required.
  // tax.bulk-verify:  bulk-attestation (no data change). Stamps
  //                   taxConfigVerified=true with an audit row per
  //                   product.
  'tax.bulk-config':                'Bulk-patch HSN / GST rate / UQC / supply taxability / cess across many products (resets attestation)',
  'tax.bulk-verify':                'Bulk-attest tax config across many products (no data change)',
  // Phase 46 (2026-05-21) — dedicated read-only key for the
  // per-product TaxAttestationLog history. Phase 45 reused
  // catalog.read which over-grants — CA / finance auditors should
  // be able to see attestation history without catalog edit rights.
  // Add to FINANCE_ADMIN / CA_ADMIN role sets in a follow-up reseed;
  // SUPER_ADMIN gets it via ALL_PERMISSION_KEYS.
  'tax.audit.read':                 'View per-product tax-attestation history (TaxAttestationLog)',

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
  'refunds.reject':         'CRITICAL',
  'refunds.confirm':        'CRITICAL',
  'refunds.manualConfirm':  'CRITICAL',
  'refunds.retry':          'HIGH',
  'refunds.markFailed':     'CRITICAL',
  'disputes.decide':        'CRITICAL',
  'disputes.decide.high_value': 'CRITICAL',
  'disputes.internalNote':  'MEDIUM',
  'disputes.override':      'CRITICAL',
  'disputes.reopen':        'HIGH',
  // Phase 0 / H24 — replies are customer-facing writes and can include
  // internal notes that are audit-visible. Not money-mutating, so
  // MEDIUM rather than HIGH.
  'disputes.reply':         'MEDIUM',
  'returns.overrideQc':     'HIGH',
  'returns.qcDecide':       'HIGH',
  'returns.approve':        'MEDIUM',
  'returns.reject':         'MEDIUM',
  'settlements.approve':    'CRITICAL',
  'settlements.markPaid':   'CRITICAL',
  'settlements.hold':       'HIGH',
  'settlements.adjustRecord': 'HIGH',
  // Locks 100s/1000s of commission records into a payout cycle → CRITICAL.
  'settlements.createCycle': 'CRITICAL',
  // Moves a seller's payable up/down (penalty/fine/goodwill) → HIGH.
  'settlements.adjust':     'HIGH',
  // Exposes dispute-resolution notes/reasons the basic list hides → MEDIUM.
  'settlements.history.read': 'MEDIUM',
  // Phase 150 — a manual debit or a cancel moves a seller's next payout → HIGH;
  // the ledger read only exposes amounts finance already sees → MEDIUM.
  'liability_ledger.write':  'HIGH',
  'liability_ledger.cancel': 'HIGH',
  'liability_ledger.read':   'MEDIUM',
  // Phase 26 (2026-05-20) — force-release CRITICAL because it lets an
  // operator override another verifier's hold, with no money side-
  // effect but a real audit-trail impact.
  'orders.forceRelease':    'CRITICAL',
  // Phase 68 (2026-05-22) — bulk-approve sweeps up to 25 orders in
  // one call (HIGH because it amplifies a single click into a batch
  // mutation across the queue). rescore is MEDIUM because the
  // blast radius is one row + downstream effect on bulk-approve
  // eligibility, not money.
  'orders.verify':          'MEDIUM',
  'orders.verify.bulk':     'HIGH',
  'orders.verify.rescore':  'MEDIUM',
  'orders.verify.tune_rules': 'HIGH',
  // Phase 74 — HIGH because reject triggers refunds + stock restore.
  'orders.reject':          'HIGH',
  // Phase 78 — MEDIUM for the standard reassign (routes between nodes,
  // no money movement); HIGH for the force variant (rolls back an
  // already-accepted commitment, can leave the original seller with
  // packed goods).
  'orders.reassign':        'MEDIUM',
  'orders.reassign.force':  'HIGH',
  // Phase 81 — MEDIUM because cancel triggers a refund (money move)
  // but only for one sub-order; HIGH for the force variant (in-transit
  // SHIPPED cancellation requires courier coordination + label
  // invalidation).
  'orders.subOrder.cancel':       'MEDIUM',
  'orders.subOrder.cancel.force': 'HIGH',
  // Phase 83 — MEDIUM because manual delivery starts the return-window
  // clock + schedules commission lock. Not money-direct but commission
  // settlement is downstream.
  'orders.deliver':               'MEDIUM',
  // Phase 85 — HIGH because the manual AWB attach path can flip a
  // sub-order to SHIPPED and overrides a seller's prior AWB; it
  // also drives the tax-invoice trigger + master rollup.
  'orders.ship.manual':           'HIGH',
  'sellers.suspend':        'HIGH',
  'sellers.penalize':       'HIGH',
  'sellers.approve':        'HIGH',
  'customers.suspend':      'HIGH',
  'customers.impersonate':  'CRITICAL',
  'franchise.suspend':      'HIGH',
  'franchise.finance':      'CRITICAL',
  'franchise.procurement_pricing': 'CRITICAL',
  'franchise.pincodes.write': 'HIGH',
  'franchise.catalog.approve': 'HIGH',
  'franchise.procurement.approve': 'CRITICAL',
  'franchise.procurement.dispatch': 'HIGH',
  'franchise.procurement.settle': 'CRITICAL',
  'franchise.pos.report.read': 'MEDIUM',
  'affiliates.commission':  'HIGH',
  'affiliates.coupons.configure': 'HIGH',
  'affiliates.coupons.create': 'HIGH',
  'affiliates.tax_report.read': 'MEDIUM',
  'affiliates.tax.deposit': 'HIGH',
  'affiliates.tax.issue_certificate': 'HIGH',
  'affiliates.payouts':     'CRITICAL',
  // Phase 155 — mark_paid moves real money → CRITICAL; the rest are HIGH.
  'affiliates.payouts.mark_paid':  'CRITICAL',
  'affiliates.payouts.approve':    'HIGH',
  'affiliates.payouts.reject':     'HIGH',
  'affiliates.payouts.mark_failed':'HIGH',
  'discounts.write':        'MEDIUM',
  'roles.write':            'CRITICAL',
  'files.delete':           'MEDIUM',
  'content.publish':        'MEDIUM',
  'support.promoteToDispute': 'HIGH',
  'nova.stock':             'MEDIUM',
  'cod.write':              'MEDIUM',
  'payouts.export':         'HIGH',
  'payouts.ingestResponse': 'HIGH',
  'payouts.cancel':         'HIGH',
  'recon.transition':       'MEDIUM',

  // Tax / GST / Invoice — high-risk classifications
  'tax.invoice.regeneratePdf':      'HIGH',
  'tax.creditNote.create':          'CRITICAL',
  'tax.creditNote.timebarOverride': 'CRITICAL',
  'tax.debitNote.create':           'CRITICAL',
  'tax.ewayBill.override':          'HIGH',
  'tax.tcs.markFiled':              'HIGH',
  'tax.tcs.markPaidToGovt':         'HIGH',
  'tax.tcs.reverse':                'CRITICAL',
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
    'disputes.read', 'disputes.reply', 'disputes.internalNote', 'disputes.assign', 'disputes.statusUpdate', 'disputes.decide',
    'settlements.read', 'settlements.history.read', 'settlements.createCycle', 'settlements.adjust', 'settlements.approve', 'settlements.markPaid', 'settlements.hold', 'settlements.adjustRecord',
    // Phase 150 — the settlement-ops tier owns the seller-debit claw-back queue.
    'liability_ledger.read', 'liability_ledger.write', 'liability_ledger.cancel',
    'payouts.read', 'payouts.export', 'payouts.ingestResponse', 'payouts.cancel',
    'recon.read', 'recon.run', 'recon.transition',
    'paymentOps.read', 'paymentOps.transition',
    'orders.read', 'orders.cancel',
    // Phase 68 (2026-05-22) — verifier permissions in the
    // SELLER_OPERATIONS tier (audit Gap #6). orders.verify covers
    // single-order claim/approve/reject; orders.verify.bulk for
    // sweeping GREEN orders. orders.verify.rescore stays
    // SUPER_ADMIN-only via ALL_PERMISSION_KEYS — flipping a band
    // alters bulk-approve eligibility downstream and we want the
    // SUPER_ADMIN audit trail on that.
    'orders.verify', 'orders.verify.bulk', 'orders.reject',
    // Phase 78 — routing ops manage reassign as part of the verification
    // queue. orders.reassign.force stays SUPER_ADMIN-only via
    // ALL_PERMISSION_KEYS because force-override of an ACCEPTED
    // sub-order has bigger blast radius (Gap #19).
    'orders.reassign',
    // Phase 81 — mid-flow per-sub-order cancel sits with the same
    // operations tier. .force stays SUPER_ADMIN-only via
    // ALL_PERMISSION_KEYS for the same blast-radius reason.
    'orders.subOrder.cancel',
    // Phase 83 — customer-support tier needs deliver to fix mis-
    // tracked shipments without granting cancel rights.
    'orders.deliver',
    // Phase 85 — shipping-ops tier attaches AWBs when seller's
    // self-serve flow is broken or the order was bulk-shipped via
    // platform booking. SUPER_ADMIN gets this via ALL_PERMISSION_KEYS.
    'orders.ship.manual',
    'returns.read', 'returns.approve', 'returns.reject',
    'returns.schedulePickup', 'returns.receive',
    'returns.uploadQcEvidence', 'returns.qcDecide', 'returns.close',
    'returns.export',
    'sellerReversals.read', 'sellerReversals.approve',
    'refunds.read', 'refunds.initiate', 'refunds.confirm', 'refunds.retry',
    // Phase 105 (2026-05-23) — Phase 102 audit Gap #8 closure. The
    // SELLER_OPERATIONS role includes mark-failed because it's the
    // tier that owns refund recovery; granular separation from retry
    // protects against accidental promotion.
    'refunds.markFailed',
    'cod.read', 'cod.write', 'audit.read', 'files.read',
    'support.read', 'support.assign', 'support.setStatus', 'support.setPriority',
    'support.categoriesManage', 'support.reply', 'support.promoteToDispute',
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
    'affiliates.commission', 'affiliates.coupons.configure', 'affiliates.coupons.create',
    'affiliates.tax_report.read', 'affiliates.tax.deposit',
    'affiliates.tax.issue_certificate', 'affiliates.payouts',
    // Phase 155 — granular payout permissions (this tier holds the broad one).
    'affiliates.payouts.approve', 'affiliates.payouts.reject',
    'affiliates.payouts.mark_paid', 'affiliates.payouts.mark_failed',
  ],
};
