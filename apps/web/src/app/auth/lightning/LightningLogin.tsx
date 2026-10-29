'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { PilotProfile } from '@sats-wars/shared';
import { Logo } from '@/components/Logo';
import { QrCode } from '@/components/QrCode';
import { ApiError, api, storage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Term } from '@/components/Term';

interface Start {
  challengeId: string;
  lnurl: string;
  expiresAt: number;
  mockWallet: boolean;
  realWallets: boolean;
}
type Status =
  | { status: 'PENDING' | 'FAILED' | 'EXPIRED' }
  | {
      status: 'VERIFIED';
      purpose: 'LOGIN' | 'LINK';
      pilot: PilotProfile;
      mergeOffer?: { token: string; guestCallsign: string; sorties: number } | null;
    };

/** Only same-site paths are accepted as the return target (no open redirect). */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/play';
}

/** Per-device seed for the demo wallet. Demo only: real wallets keep their own keys. */
function mockSeed(): string {
  let s = storage.get('sw.mockWalletSeed');
  if (!s) {
    s =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.set('sw.mockWalletSeed', s);
  }
  return s;
}

/**
 * LNURL-auth (LUD-04): scan with a Lightning wallet, the wallet signs a
 * one-time challenge, and this browser (bound by a cookie) gets the session.
 * It proves the pilot holds a key — not who they are. We never ask for seeds
 * or private keys.
 */
export function LightningLogin() {
  const { L } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const purpose = params.get('link') === '1' ? 'LINK' : 'LOGIN';
  const [start, setStart] = useState<Start | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      setStart(await api<Start>('/api/auth/lightning/start', { body: { purpose } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [purpose]);

  useEffect(() => {
    void begin();
  }, [begin]);

  useEffect(() => {
    if (!start || (status && status.status !== 'PENDING')) return;
    const id = setInterval(async () => {
      try {
        const st = await api<Status>(`/api/auth/lightning/status/${start.challengeId}`);
        if (st.status !== 'PENDING') setStatus(st);
        if (st.status === 'PENDING' && Date.now() > start.expiresAt)
          setStatus({ status: 'EXPIRED' });
      } catch {
        // keep polling
      }
    }, 1500);
    return () => clearInterval(id);
  }, [start, status]);

  useEffect(() => {
    if (status?.status === 'VERIFIED' && !status.mergeOffer) router.push(next);
  }, [status, router, next]);

  const approveMock = async () => {
    if (!start) return;
    setBusy(true);
    try {
      await api('/api/auth/lightning/mock-approve', {
        body: { challengeId: start.challengeId, walletSeed: mockSeed() },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const merge = async (yes: boolean) => {
    if (status?.status !== 'VERIFIED' || !status.mergeOffer) return;
    if (yes) {
      try {
        await api('/api/auth/merge-guest', { body: { token: status.mergeOffer.token } });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
        return;
      }
    }
    router.push(next);
  };

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4"
      data-testid="lightning-login-page"
    >
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      <h1 className="sw-display text-2xl">
        {purpose === 'LINK'
          ? L('ウォレットを連携', 'Link a wallet')
          : L('Lightningでログイン', 'Log in with Lightning')}
      </h1>
      <p className="text-xs">
        <Term k="lightning">{L('Lightningとは？', 'What is Lightning?')}</Term>
        {' · '}
        <Term k="auth">{L('ウォレット認証とは？', 'What is wallet login?')}</Term>
      </p>
      <p className="text-sm text-muted">
        {L(
          'ウォレットでQRを読むと、このブラウザでログインできます。鍵を持っていることの確認で、本人確認ではありません。秘密鍵やシードを入力させることはありません。',
          'Scan with your wallet to log in on this browser. It proves you hold a key — it is not an identity check. We never ask for seeds or private keys.',
        )}
      </p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {status?.status === 'VERIFIED' && status.mergeOffer ? (
        <div className="sw-panel flex flex-col gap-3 p-4" data-testid="merge-offer">
          <p className="font-bold">
            {L(
              `このブラウザのゲスト「${status.mergeOffer.guestCallsign}」（出撃${status.mergeOffer.sorties}回）の記録を引き継ぎますか？`,
              `Bring the records of guest "${status.mergeOffer.guestCallsign}" (${status.mergeOffer.sorties} sorties) to this wallet pilot?`,
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="sw-btn flex-1 bg-amber text-navy"
              onClick={() => void merge(true)}
              data-testid="merge-yes"
            >
              {L('引き継ぐ', 'Bring them')}
            </button>
            <button
              type="button"
              className="sw-btn flex-1 bg-navy-3"
              onClick={() => void merge(false)}
            >
              {L('引き継がない', 'No thanks')}
            </button>
          </div>
        </div>
      ) : status?.status === 'VERIFIED' ? (
        <p className="sw-panel p-4 font-bold">{L('ログインしました！', 'Logged in!')}</p>
      ) : status && status.status !== 'PENDING' ? (
        <div className="sw-panel flex flex-col gap-2 p-4">
          <p>{L('期限が切れました', 'This login expired')}</p>
          <button type="button" className="sw-btn bg-teal text-navy" onClick={() => void begin()}>
            {L('やり直す', 'Try again')}
          </button>
        </div>
      ) : start ? (
        <div className="sw-panel flex flex-col items-center gap-3 p-4">
          {start.realWallets && (
            <>
              <QrCode
                url={`lightning:${start.lnurl}`}
                size={260}
                caption={false}
                label={L('LNURLログイン用QR', 'LNURL login QR')}
              />
              <a
                className="sw-btn sw-focus flex w-full items-center justify-center bg-teal text-navy"
                href={`lightning:${start.lnurl}`}
              >
                {L('ウォレットを開く', 'Open wallet')}
              </a>
            </>
          )}
          {start.mockWallet && (
            <button
              type="button"
              className="sw-btn w-full bg-amber text-navy"
              onClick={() => void approveMock()}
              disabled={busy}
              data-testid="mock-wallet-approve"
            >
              🧪 {L('テスト用ウォレットで承認（デモ）', 'Approve with the test wallet (demo)')}
            </button>
          )}
          <p className="text-xs text-muted">
            {L('ウォレットの承認を待っています…', 'Waiting for the wallet…')}
          </p>
        </div>
      ) : (
        <p>{L('準備中…', 'Preparing…')}</p>
      )}
      <Link className="text-sm text-muted underline" href={next}>
        {L('戻る', 'Back')}
      </Link>
    </main>
  );
}
