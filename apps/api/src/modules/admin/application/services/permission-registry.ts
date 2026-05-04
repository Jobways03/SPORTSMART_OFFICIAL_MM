/**
 * Code-side enumeration of all permission keys. Adding a key here is
 * the source of truth — admin UI lists exactly these for assignment.
 *
 * Convention: <module>.<verb> in lowercase. Verbs follow CRUD where
 * possible (read/create/update/delete) plus action verbs (approve,
 * decide, block, unblock, retry, override).
 */
export const PERMISSIONS = {
  // Wallets
  'wallets.read':           'View wallet balances + history',
  'wallets.adjust':         'Manually credit/debit wallets',
  'wallets.block':          'Block/unblock wallets',
  // Disputes
  'disputes.read':          'View disputes',
  'disputes.assign':        'Assign disputes to reviewers',
  'disputes.decide':        'Issue dispute decisions (incl refund amount)',
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
  // Sellers
  'sellers.read':           'View seller list + profile',
  'sellers.approve':        'Approve seller onboarding',
  'sellers.suspend':        'Suspend / activate sellers',
  // Products
  'products.read':          'View catalog',
  'products.approve':       'Approve product moderation',
  // Orders
  'orders.read':            'View orders',
  'orders.cancel':          'Cancel orders (admin override)',
  // Returns
  'returns.read':           'View returns',
  'returns.decide':         'Approve / reject returns + refund',
  // COD
  'cod.read':               'View COD rules + decisions',
  'cod.write':              'Create / edit COD rules',
  // Roles
  'roles.read':             'View roles + permissions',
  'roles.write':            'Create / edit roles + assign permissions',
  // Audit
  'audit.read':             'View + export audit log',
  // Notifications
  'notifications.read':     'View notification logs + templates',
  'notifications.write':    'Edit templates + retry notifications',
  // Files
  'files.read':             'View file metadata across actors',
  'files.delete':           'Delete files',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/**
 * Default permission grant per system role. Used by the seeder + by
 * the resolver when an admin's role enum value isn't in any custom Role.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<string, readonly PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  SELLER_OPERATIONS: [
    'wallets.read', 'wallets.adjust', 'wallets.block',
    'disputes.read', 'disputes.assign', 'disputes.decide',
    'settlements.read', 'settlements.approve', 'settlements.markPaid',
    'payouts.read', 'payouts.export', 'payouts.ingestResponse',
    'recon.read', 'recon.run', 'recon.transition',
    'paymentOps.read', 'paymentOps.transition',
    'orders.read', 'orders.cancel', 'returns.read', 'returns.decide',
    'cod.read', 'cod.write', 'audit.read', 'files.read',
  ],
  SELLER_ADMIN: [
    'sellers.read', 'sellers.approve', 'sellers.suspend',
    'products.read', 'products.approve',
    'orders.read', 'returns.read',
  ],
  SELLER_SUPPORT: [
    'wallets.read', 'disputes.read',
    'orders.read', 'returns.read', 'paymentOps.read',
    'notifications.read',
  ],
  AFFILIATE_ADMIN: [
    'sellers.read', 'orders.read', 'audit.read',
  ],
};
