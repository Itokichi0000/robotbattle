'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Demo hub (spec E1 /demo): the offline experience with BOT pilots (no
 * wallet, no server, nothing sent anywhere) and, when the venue server runs
 * in DEMO_MODE, the live screens with mock payments and mock login.
 */
export function DemoView() {
  const { L } = useI18n();
  const [demoServer, setDemoServer] = useState<boolean | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    api<{ demo: boolean }>('/api/auth/modes')
      .then((m) => setDemoServer(m.demo))
      .catch(() => setDemoServer(null));
    fetch('/demo/solo.html', { method: 'HEAD' })
      .then((r) => setOffline(r.ok))
      .catch(() => setOffline(false));
  }, []);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4" data-testid="demo">
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      <h1 className="sw-display text-2xl">{L('デモで遊ぶ', 'Try the demo')}</h1>
      <section className="sw-panel flex flex-col gap-3 p-4">
        <h2 className="font-black">
          {L('オフライン体験版（BOTの仲間と1人で）', 'Offline demo (you + BOT pilots)')}
        </h2>
        <p className="text-sm">
          {L(
            '大画面とスマホの操縦席を1画面で。ウォレット・ログイン・通信は不要で、何も送信しません。',
            'Big screen and phone cockpit in one page. No wallet, no login, nothing is sent anywhere.',
          )}
        </p>
        {offline ? (
          <>
            <iframe
              title={L('オフライン体験版', 'Offline demo')}
              src="/demo/solo.html"
              className="aspect-video w-full rounded-xl border border-line"
              data-testid="demo-frame"
            />
            <a
              className="sw-btn sw-focus flex items-center justify-center bg-amber text-navy"
              href="/demo/solo.html"
              target="_blank"
              rel="noopener"
            >
              ⛶ {L('全画面で開く', 'Open full screen')}
            </a>
          </>
        ) : (
          <p className="text-sm text-muted">
            {L(
              'オフライン版が未ビルドです：pnpm solo（または pnpm build）を実行してください。',
              'The offline demo is not built yet: run pnpm solo (or pnpm build).',
            )}
          </p>
        )}
      </section>
      <section className="sw-panel flex flex-col gap-2 p-4 text-sm">
        <h2 className="font-black">
          {L('会場モード（サーバーあり）', 'Venue mode (with the server)')}
        </h2>
        {demoServer ? (
          <p>
            ✅{' '}
            {L(
              'このサーバーは DEMO_MODE です（無料パス・テスト用ログイン・BOT）。',
              'This server runs DEMO_MODE (free passes, mock login, bots).',
            )}
          </p>
        ) : (
          <p className="text-muted">
            {L(
              'DEMO_MODE で起動すると、BOTの仲間と一緒に会場画面とスマホで遊べます：',
              'Start the server in DEMO_MODE to play with BOT pilots on the venue screen and phones:',
            )}
            <code className="mt-1 block rounded bg-navy p-2 text-xs">
              ADMIN_PASSWORD=… DEMO_MODE=true DEMO_BOTS=5 pnpm dev
            </code>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link className="sw-btn sw-focus bg-navy-3 px-3" href="/arena">
            🖥 {L('会場画面', 'Venue screen')}
          </Link>
          <Link className="sw-btn sw-focus bg-navy-3 px-3" href="/play">
            📱 {L('操縦席（スマホ）', 'Cockpit (phone)')}
          </Link>
          <Link className="sw-btn sw-focus bg-navy-3 px-3" href="/arena?preview=1">
            🎬 {L('演出リハーサル', 'Effects rehearsal')}
          </Link>
        </div>
      </section>
    </main>
  );
}
