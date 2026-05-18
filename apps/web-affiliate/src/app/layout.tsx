import type { Metadata } from 'next';
import { ModalProvider } from '@sportsmart/ui';

export const metadata: Metadata = {
  title: 'SportsMart — Affiliate Portal',
  description: 'Manage your referral links, coupon codes, commissions, and payouts.',
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
            so any destructive action can use the shared in-app prompt
            instead of window.confirm(), which mobile browsers render
            inconsistently. */}
        <ModalProvider>{children}</ModalProvider>
      </body>
    </html>
  );
}
