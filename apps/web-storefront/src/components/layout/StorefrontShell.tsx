import type { ReactNode } from 'react';
import { AnnouncementBar } from './AnnouncementBar';
import { Navbar } from './Navbar';
import { UpgradeBanner } from './UpgradeBanner';
import { Footer } from './Footer';

/**
 * Standard customer-facing chrome: top announcement bar, sticky navbar,
 * page content, and footer. Use on every storefront page that isn't auth.
 */
export function StorefrontShell({
  children,
  withFooter = true,
}: {
  children: ReactNode;
  withFooter?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AnnouncementBar />
      <Navbar />
      <UpgradeBanner />
      <main className="flex-1">{children}</main>
      {withFooter && <Footer />}
    </div>
  );
}
