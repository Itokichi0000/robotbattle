import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'SATS WARS — 雷神 vs 風神',
  description: 'スマホで参加する日本列島陣取り × 会場大型スクリーンの3Dロボットバトル',
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
