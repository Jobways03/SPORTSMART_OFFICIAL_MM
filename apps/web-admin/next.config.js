/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sportsmart/ui', '@sportsmart/shared-types', '@sportsmart/shared-utils'],
};

module.exports = nextConfig;
