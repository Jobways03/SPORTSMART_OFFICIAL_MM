/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sportsmart/ui', '@sportsmart/shared-utils'],
  async redirects() {
    // Legacy /legal/* hrefs (used by register / login / footer) never had
    // matching routes — the real content lives at /pages/*. Redirect so none of
    // those links 404. 307 (temporary) while the legal pages are still evolving.
    return [
      { source: '/legal/terms', destination: '/pages/terms-and-conditions', permanent: false },
      { source: '/legal/privacy', destination: '/pages/privacy-policy', permanent: false },
      { source: '/legal/returns', destination: '/pages/refund-policy', permanent: false },
      { source: '/legal/cookies', destination: '/pages/privacy-policy', permanent: false },
    ];
  },
};

module.exports = nextConfig;
