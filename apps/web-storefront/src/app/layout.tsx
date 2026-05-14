import type { Metadata, Viewport } from 'next';
import { Inter, Bebas_Neue, Permanent_Marker } from 'next/font/google';
import { ModalProvider } from '@sportsmart/ui';
import { ServiceWorkerRegister } from './_components/sw-register';
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

export const metadata: Metadata = {
  title: 'SPORTSMART — India\'s Sports Marketplace',
  description: 'Shop premium sports gear, apparel, and accessories. From sellers across India, delivered to your door.',
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${bebas.variable} ${permanentMarker.variable}`}>
      <body className="bg-white text-ink-900 antialiased">
        <ModalProvider>{children}</ModalProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
