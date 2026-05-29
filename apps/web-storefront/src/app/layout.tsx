import type { Metadata, Viewport } from 'next';
import { Inter, Bebas_Neue, Permanent_Marker } from 'next/font/google';
import { ModalProvider } from '@sportsmart/ui';
import { ServiceWorkerRegister } from './_components/sw-register';
import { GlobalErrorNormalizer } from './_components/global-error-normalizer';
import { AuthProvider } from '@/lib/auth-context';
import '../styles/globals.css';
import '../styles/storefront.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const bebas = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

// Brush-script energy font — used sparingly on hero callouts and
// "REVAMP YOUR GAME" style banners to inject athletic edge.
const permanentMarker = Permanent_Marker({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-brush',
  display: 'swap',
});

/**
 * Phase 8 (2026-05-16) — SEO foundation for the storefront.
 *
 * `metadataBase` is the prefix Next.js uses to resolve relative URLs
 * in `metadata.alternates.canonical` and Open Graph image paths.
 * Reads from `NEXT_PUBLIC_STOREFRONT_URL` so staging + prod each
 * advertise the right hostname; falls back to localhost for dev.
 *
 * The default `alternates.canonical = '/'` makes the homepage the
 * canonical URL when no per-page `generateMetadata` overrides it.
 * Product pages and category pages MUST set their own canonical
 * via `generateMetadata` — otherwise the prefix is applied verbatim
 * to whatever pathname Next has.
 */
const SITE_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || 'http://localhost:4005';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "SPORTSMART — India's Sports Marketplace",
    template: '%s | SPORTSMART',
  },
  description: 'Shop premium sports gear, apparel, and accessories. From sellers across India, delivered to your door.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'SPORTSMART',
    title: "SPORTSMART — India's Sports Marketplace",
    description: 'Shop premium sports gear, apparel, and accessories.',
    locale: 'en_IN',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: "SPORTSMART — India's Sports Marketplace",
    description: 'Shop premium sports gear, apparel, and accessories.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  manifest: '/manifest.json',
  applicationName: 'Sportsmart',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sportsmart',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#3FA1AE',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Phase 8 (2026-05-16) — Organization + WebSite JSON-LD.
 *
 * Emitted once at the root so every page inherits the sitewide
 * structured-data context. The Organization payload powers
 * knowledge-panel results; the WebSite payload (with `potentialAction`)
 * unlocks Google's "Sitelinks searchbox" in SERPs.
 */
const ORG_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'SPORTSMART',
  url: SITE_URL,
  logo: `${SITE_URL}/icons/icon-512.png`,
  sameAs: [] as string[], // populate when social URLs are confirmed
};

const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'SPORTSMART',
  url: SITE_URL,
  potentialAction: {
    '@type': 'SearchAction',
    target: `${SITE_URL}/search?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${bebas.variable} ${permanentMarker.variable}`}>
      <body className="bg-white text-ink-900 antialiased">
        {/* Sitewide structured data — server-rendered so crawlers can read it. */}
        {/* eslint-disable-next-line react/no-danger */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
        />
        {/* eslint-disable-next-line react/no-danger */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }}
        />
        <GlobalErrorNormalizer />
        <AuthProvider>
          <ModalProvider>{children}</ModalProvider>
        </AuthProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
