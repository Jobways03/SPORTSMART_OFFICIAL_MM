import { createApiClient } from '@sportsmart/shared-utils';

export { ApiError } from '@sportsmart/shared-utils';
export type { ApiResponse } from '@sportsmart/shared-utils';

// Phase 38 — RETAIL seller-admin app. See web-d2c-seller-admin's
// api-client for the full pattern; this app pins the discriminator
// to RETAIL.
export const SELLER_TYPE = 'RETAIL' as const;

const { apiClient, API_BASE } = createApiClient({
  accessTokenKey: 'adminAccessToken',
  refreshTokenKey: 'adminRefreshToken',
  userKey: 'admin',
  refreshPath: 'admin/auth/refresh',
  defaultHeaders: { 'X-Seller-Type': SELLER_TYPE },
});

export { apiClient, API_BASE };
