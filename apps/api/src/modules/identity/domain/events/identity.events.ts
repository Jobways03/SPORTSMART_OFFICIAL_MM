export const IDENTITY_EVENTS = {
  USER_REGISTERED: 'identity.user.registered',
  USER_LOGGED_IN: 'identity.user.logged_in',
  PASSWORD_RESET_REQUESTED: 'identity.user.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'identity.user.password_reset_completed',
  ADMIN_MFA_ENABLED: 'identity.admin.mfa_enabled',
  SESSION_REVOKED: 'identity.session.revoked',
} as const;
