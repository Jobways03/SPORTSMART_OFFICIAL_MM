import { createApiClient } from '@sportsmart/shared-utils';

export { ApiError } from '@sportsmart/shared-utils';
export type { ApiResponse } from '@sportsmart/shared-utils';

// FRANCHISE admin app. Mirrors the retail/d2c seller-admin pattern:
// the X-Seller-Type header pins every admin API call to this persona
// so backend services that key off persona (e.g. logistics-partner
// admin endpoints, persona-scoped admin lists) route correctly.
// Defence-in-depth: the admin role/permission system is still enforced
// backend-side regardless of the header.
export const SELLER_TYPE = 'FRANCHISE' as const;

const { apiClient, API_BASE } = createApiClient({
  accessTokenKey: 'adminAccessToken',
  refreshTokenKey: 'adminRefreshToken',
  userKey: 'admin',
  refreshPath: 'admin/auth/refresh',
  defaultHeaders: { 'X-Seller-Type': SELLER_TYPE },
});

export { apiClient, API_BASE };
