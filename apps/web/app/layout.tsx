import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Voice',
  description: 'A voice and text console for talking to a connected tool-using agent.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
