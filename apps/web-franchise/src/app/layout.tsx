import type { Metadata } from 'next';
import { ModalProvider } from '@sportsmart/ui';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'SPORTSMART Franchise Portal',
  description: 'Manage your franchise operations',
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
