import { useTicker } from '@swed/client';
import { IconBolt, IconPilot } from '@swed/ui-tokens';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearNotice,
  pollLnurl,
  signInDemoGuest,
  startLnurl,
  type LnurlAttempt,
  type LnurlPoll,
  type PilotSessionState,
} from '../net';
import { useL } from '../ui';

/**
 * Join page. Pilot authentication is free and never a payment (spec §7, §9.7).
 * LNURL-auth: open the wallet on this phone (same device), or copy the link, or show a
 * personal QR for a wallet on another device. DEMO GUEST is a clearly labelled test entry.
 */

function LnurlPanel() {
  const { L } = useL();
  const [attempt, setAttempt] = useState<LnurlAttempt | null>(null);
  const [state, setState] = useState<LnurlPoll | 'IDLE' | 'STARTING'>('IDLE');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useTicker(500);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (!attempt || busy.current) return;
    busy.current = true;
    const r = await pollLnurl(attempt.attemptId);
    busy.current = false;
    if (r !== 'NETWORK') setState(r);
  }, [attempt]);

  // Poll while waiting, and immediately when the pilot comes back from the wallet app.
  useEffect(() => {
    if (!attempt || state !== 'PENDING') return;
    const id = setInterval(() => void poll(), 1_500);
    const onVisible = () => document.visibilityState === 'visible' && void poll();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [attempt, state, poll]);

  const begin = async () => {
    setState('STARTING');
    setShowQr(false);
    const a = await startLnurl();
    if (!a) {
      setState('NETWORK');
      return;
    }
    setAttempt(a);
    setState('PENDING');
  };

  const left = attempt ? Math.max(0, Date.parse(attempt.expiresAt) - Date.now()) : 0;
  void now;
  const expired = state === 'EXPIRED' || (state === 'PENDING' && left <= 0);
  const message: Record<string, string> = {
    EXPIRED: L(
      '認証リンクの期限が切れました。もう一度お試しください。',
      'The sign-in link expired. Try again.',
    ),
    FAILED: L(
      'ウォレットの署名を確認できませんでした。LNURL-auth 非対応のウォレットかもしれません。',
      'The wallet signature did not verify. The wallet may not support LNURL-auth.',
    ),
    NOT_FOUND: L(
      'この認証は使えません。もう一度最初から。',
      'This sign-in cannot be used. Start again.',
    ),
    NETWORK: L(
      'サーバーに接続できません。電波を確認して再試行。',
      'Cannot reach the server. Check signal and retry.',
    ),
  };

  if (!attempt || state === 'IDLE' || state === 'STARTING' || state === 'NETWORK') {
    return (
      <>
        <button
          className="btn primary ally"
          onClick={() => void begin()}
          disabled={state === 'STARTING'}
        >
          <IconBolt size={22} />
          <span>
            {state === 'STARTING'
              ? L('準備中…', 'Preparing…')
              : L('Lightningウォレットで認証', 'Sign in with a Lightning wallet')}
            <small>
              {L('LNURL-auth・無料・支払いは発生しません', 'LNURL-auth · free · no payment')}
            </small>
          </span>
        </button>
        {state === 'NETWORK' ? (
          <p className="err" role="alert">
            {message.NETWORK}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="lnurl">
      {expired || state === 'FAILED' || state === 'NOT_FOUND' ? (
        <>
          <p className="err" role="alert">
            {message[expired ? 'EXPIRED' : state]}
          </p>
          <button className="btn" onClick={() => void begin()}>
            {L('もう一度', 'Try again')}
          </button>
        </>
      ) : (
        <>
          <a className="btn primary ally" href={`lightning:${attempt.lnurl}`}>
            <IconBolt size={22} />
            <span>
              {L('ウォレットを開いて承認', 'Open wallet and approve')}
              <small>
                {L('承認したらこの画面に戻ってください', 'Then come back to this page')}
              </small>
            </span>
          </a>
          <div className="lnurl-row">
            <button
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(attempt.lnurl);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? L('コピーしました', 'Copied') : L('リンクをコピー', 'Copy link')}
            </button>
            <button className="btn" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
              {L('別の端末で読む', 'Use another device')}
            </button>
          </div>
          {showQr ? (
            <img
              className="lnurl-qr"
              alt={L('LNURL-auth の QR（あなた専用）', 'Your personal LNURL-auth QR')}
              src={`data:image/svg+xml;utf8,${encodeURIComponent(attempt.qrSvg)}`}
            />
          ) : null}
          <p className="note" aria-live="polite">
            {L('ウォレットの承認を待っています', 'Waiting for your wallet')} ·{' '}
            <span className="sw-num">{Math.ceil(left / 1000)}s</span>
          </p>
        </>
      )}
      <p className="fine">
        {L(
          '署名で「鍵を持っていること」だけを確認します（本人確認ではありません）。本名・メール・秘密鍵は不要です。',
          'A signature proves you hold a key (not who you are). No name, e-mail or private key is needed.',
        )}
      </p>
    </div>
  );
}

export function Join({ session }: { session: PilotSessionState }) {
  const { L, lang, setLang } = useL();
  const [busy, setBusy] = useState(false);
  const err =
    session.error === 'DEMO_DISABLED'
      ? L(
          'この会場ではDEMO GUESTは無効です。Lightningウォレットで認証してください。',
          'DEMO GUEST is off here. Please sign in with a wallet.',
        )
      : session.error === 'NETWORK'
        ? L(
            'サーバーに接続できません。電波を確認して再試行してください。',
            'Cannot reach the server. Check signal and retry.',
          )
        : session.error
          ? L(
              '搭乗手続きに失敗しました。もう一度お試しください。',
              'Sign-in failed. Please try again.',
            )
          : null;
  return (
    <main className="screen join">
      <div className="join-top">
        <span className="ph-brand">SATS WARS / PILOT</span>
        <button className="ph-lang" onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}>
          {lang === 'ja' ? 'EN' : 'JA'}
        </button>
      </div>
      {session.notice === 'SESSION_REPLACED' ? (
        <p className="err" role="alert" onClick={clearNotice}>
          {L(
            '同じウォレットで別の端末からログインしたため、この端末は降機しました。',
            'You signed in on another phone with the same wallet, so this one was signed out.',
          )}
        </p>
      ) : null}
      <section className="join-hero">
        <h1>
          SATS WARS
          <span>EARTH DEFENSE</span>
        </h1>
        <p className="tag">ONE MECH. EIGHT PILOTS. DEFEND JAPAN.</p>
        <p className="lead">
          {L(
            '巨大ロボ RAIJIN-01 に仲間と乗り込み、侵略体 NULL SWARM から日本を守る協力ゲーム。あなたは機体の一部を担当します。',
            'Board the giant RAIJIN-01 with other pilots and defend Japan from the NULL SWARM. You run one part of the machine.',
          )}
        </p>
      </section>
      <section
        className="auth sw-frame"
        style={{ ['--sw-frame-accent' as string]: 'var(--sw-ally)' }}
      >
        <div className="auth-k">{L('パイロット認証（無料）', 'PILOT SIGN-IN (FREE)')}</div>
        <LnurlPanel />
        {session.demoGuestEnabled ? (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signInDemoGuest();
              setBusy(false);
            }}
          >
            <IconPilot size={20} />
            <span>
              {busy
                ? L('搭乗手続き中…', 'Signing in…')
                : L('ウォレットなしで DEMO GUEST', 'No wallet? DEMO GUEST')}
              <small>
                {L(
                  'テスト用・無料・本番認証ではありません',
                  'Test mode · free · not a real sign-in',
                )}
              </small>
            </span>
          </button>
        ) : null}
        {err ? (
          <p className="err" role="alert">
            {err}
          </p>
        ) : null}
      </section>
      <p className="fine">
        {L(
          '秘密鍵・シードフレーズ・本名・メールは一切不要です。絶対に入力しないでください。',
          'We never ask for private keys, seed phrases, names or e-mail. Never enter them.',
        )}
      </p>
    </main>
  );
}
