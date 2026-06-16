import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Sportsmart Admin',
  description: 'Sportsmart internal admin console.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-ink-900 antialiased">{children}</body>
    </html>
  );
}
