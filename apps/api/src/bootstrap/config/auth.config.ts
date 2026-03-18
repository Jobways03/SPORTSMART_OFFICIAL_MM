export const authConfig = () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET || '',
  refreshSecret: process.env.JWT_REFRESH_SECRET || '',
  accessTtl: process.env.JWT_ACCESS_TTL || '7d',
  refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
});
