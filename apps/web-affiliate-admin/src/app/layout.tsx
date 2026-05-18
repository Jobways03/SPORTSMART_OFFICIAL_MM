import type { Metadata } from 'next';
import { ModalProvider } from '@sportsmart/ui';

export const metadata: Metadata = {
  title: 'SportsMart — Affiliate Admin',
  description:
    'Manage affiliate applications, commissions, payouts, KYC, and fraud monitoring.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
          minHeight: '100vh',
        }}
      >
        {/* Phase 8 (2026-05-16) — ModalProvider exposes useModal().confirmDialog
            so destructive admin actions use the shared in-app prompt
            rather than window.confirm(), which mobile browsers render
            inconsistently. */}
        <ModalProvider>{children}</ModalProvider>
      </body>
    </html>
  );
}
