import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Voice',
  description: 'A voice and text console for talking to a connected tool-using agent.',
};

/**
 * `viewportFit: 'cover'` is what makes `env(safe-area-inset-*)` report real
 * values on notched devices, which the bottom dock relies on.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
  themeColor: '#08080a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
