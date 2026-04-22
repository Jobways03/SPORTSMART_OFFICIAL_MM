import type { Metadata } from 'next';
import { ModalProvider } from '@sportsmart/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'SPORTSMART Admin',
  description: 'Main administration for SPORTSMART marketplace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ModalProvider>{children}</ModalProvider>
      </body>
    </html>
  );
}
