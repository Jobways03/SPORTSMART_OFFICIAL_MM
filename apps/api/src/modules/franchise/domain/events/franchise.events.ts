export const FRANCHISE_EVENTS = {
  // Auth events
  REGISTERED: 'franchise.registered',
  LOGGED_IN: 'franchise.logged_in',
  LOGIN_FAILED: 'franchise.login_failed',
  ACCOUNT_LOCKED: 'franchise.account_locked',
  PASSWORD_RESET_REQUESTED: 'franchise.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'franchise.password_reset_completed',

  // Profile events
  PROFILE_UPDATED: 'franchise.profile_updated',

  // Admin events
  STATUS_UPDATED: 'franchise.status_updated',
  VERIFICATION_UPDATED: 'franchise.verification_updated',
  COMMISSION_UPDATED: 'franchise.commission_updated',

  // Phase 2 events
  ONBOARDING_APPROVED: 'franchise.onboarding.approved',
  PINCODE_MAPPED: 'franchise.pincode.mapped',
  FEE_RECORDED: 'franchise.fee.recorded',
  EARNING_LOCKED: 'franchise.earning.locked',
} as const;
