import { createApiClient } from '@sportsmart/shared-utils';

export { ApiError } from '@sportsmart/shared-utils';
export type { ApiResponse } from '@sportsmart/shared-utils';

// Phase 38 — RETAIL seller portal. The seller-type discriminator is
// baked into every request via the X-Seller-Type header and (for
// registration) into the JSON body via SELLER_TYPE below.
export const SELLER_TYPE = 'RETAIL' as const;

const { apiClient, API_BASE } = createApiClient({
  accessTokenKey: 'accessToken',
  refreshTokenKey: 'refreshToken',
  userKey: 'seller',
  refreshPath: 'seller/auth/refresh',
  defaultHeaders: { 'X-Seller-Type': SELLER_TYPE },
});

export { apiClient, API_BASE };
