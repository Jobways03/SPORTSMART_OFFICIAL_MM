import type { Metadata } from 'next';
import { ModalProvider } from '@sportsmart/ui';
import { StepUpHandlerProvider } from '../components/StepUpHandlerProvider';

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
        <ModalProvider>
          {/*
           * Wraps the whole app so destructive routes that 403 with
           * code: 'STEP_UP_REQUIRED' open the step-up modal automatically.
           * The handler registers with this app's api-helper at mount; any
           * apiFetch(...) call gets the recovery UX for free. (This app does
           * not use the shared createApiClient — see src/lib/api.ts.)
           */}
          <StepUpHandlerProvider>{children}</StepUpHandlerProvider>
        </ModalProvider>
      </body>
    </html>
  );
}
