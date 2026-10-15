import type { Metadata } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Infringe | Metro Detroit Crime Atlas',
  description: 'Explore Detroit and CLEMIS reports, Michigan CJIC crime and victim records, and local news with shared filters, maps, and source-aware analysis.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
