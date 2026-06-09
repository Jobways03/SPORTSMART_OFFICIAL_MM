import type { Metadata } from 'next';
import { ModalProvider } from '@sportsmart/ui';
import { StepUpHandlerProvider } from '../components/StepUpHandlerProvider';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'SPORTSMART Seller Admin',
  description: 'Seller admin panel for SPORTSMART marketplace',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ModalProvider>
          {/*
           * Phase 38 — wraps the whole app so destructive routes that
           * 403 with code: 'STEP_UP_REQUIRED' open the step-up modal
           * automatically. The handler registers with the shared
           * api-client at mount; any apiClient(...) call (including
           * legacy ones we never edit) gets the recovery UX for free.
           */}
          <StepUpHandlerProvider>{children}</StepUpHandlerProvider>
        </ModalProvider>
      </body>
    </html>
  );
}
