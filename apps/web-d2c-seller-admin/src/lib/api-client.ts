import { createApiClient } from '@sportsmart/shared-utils';

export { ApiError } from '@sportsmart/shared-utils';
export type { ApiResponse } from '@sportsmart/shared-utils';

// Phase 38 — D2C seller-admin app. Every API call carries this scope
// via the X-Seller-Type header; the admin services also append
// `sellerType=D2C` to list-sellers queries so the backend filters
// at the SQL level. Defence-in-depth: the admin role/permission
// (seller.d2c.*) is enforced backend-side regardless of the header.
export const SELLER_TYPE = 'D2C' as const;

const { apiClient, API_BASE } = createApiClient({
  accessTokenKey: 'adminAccessToken',
  refreshTokenKey: 'adminRefreshToken',
  userKey: 'admin',
  refreshPath: 'admin/auth/refresh',
  defaultHeaders: { 'X-Seller-Type': SELLER_TYPE },
});

export { apiClient, API_BASE };
