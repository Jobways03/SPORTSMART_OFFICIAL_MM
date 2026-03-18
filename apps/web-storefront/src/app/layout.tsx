import type { Metadata } from 'next';
import '../styles/globals.css';
import '../styles/storefront.css';

export const metadata: Metadata = {
  title: 'SPORTSMART - Sports Marketplace',
  description: 'Multi-seller sports marketplace',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="footer">
          &copy; {new Date().getFullYear()} SPORTSMART. All rights reserved.
        </footer>
      </body>
    </html>
  );
}
