import type { Metadata } from 'next';
import { Inter, Bebas_Neue, Permanent_Marker } from 'next/font/google';
import { ModalProvider } from '@sportsmart/ui';
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
      </body>
    </html>
  );
}
