import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/lib/i18n';
import '@sats-wars/ui/ui.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'SATS WARS — EARTH DEFENSE',
  description: '雷神と風神をみんなで操縦して日本の8都市を守る、8分間の協力レイド',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#070D1A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
