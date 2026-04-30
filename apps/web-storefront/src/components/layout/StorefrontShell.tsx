import type { ReactNode } from 'react';
import { AnnouncementBar } from './AnnouncementBar';
import { Navbar } from './Navbar';
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
    <>
      <AnnouncementBar />
      <Navbar />
      <main>{children}</main>
      {withFooter && <Footer />}
    </>
  );
}
