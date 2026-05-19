/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sportsmart/ui', '@sportsmart/shared-utils'],
};

module.exports = nextConfig;
