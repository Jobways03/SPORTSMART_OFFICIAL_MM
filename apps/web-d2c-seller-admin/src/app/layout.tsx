import type { Metadata } from 'next';
import { ModalProvider } from '@sportsmart/ui';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'SPORTSMART D2C Seller Admin',
  description: 'D2C seller admin panel for SPORTSMART marketplace',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ModalProvider>{children}</ModalProvider>
      </body>
    </html>
  );
}
