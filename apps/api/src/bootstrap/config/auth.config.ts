const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env: ${key}`);
  return value;
};

export const authConfig = () => ({
  customerSecret: required('JWT_CUSTOMER_SECRET'),
  sellerSecret: required('JWT_SELLER_SECRET'),
  franchiseSecret: required('JWT_FRANCHISE_SECRET'),
  adminSecret: required('JWT_ADMIN_SECRET'),
  refreshSecret: required('JWT_REFRESH_SECRET'),
  accessTtl: process.env.JWT_ACCESS_TTL || '7d',
  refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
});
