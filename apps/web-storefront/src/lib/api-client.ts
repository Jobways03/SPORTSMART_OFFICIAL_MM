import { createApiClient } from '@sportsmart/shared-utils';

export { ApiError } from '@sportsmart/shared-utils';
export type { ApiResponse } from '@sportsmart/shared-utils';

const { apiClient, API_BASE } = createApiClient({
  accessTokenKey: 'accessToken',
  refreshTokenKey: 'refreshToken',
  userKey: 'user',
  refreshPath: 'auth/refresh',
});

export { apiClient, API_BASE };
