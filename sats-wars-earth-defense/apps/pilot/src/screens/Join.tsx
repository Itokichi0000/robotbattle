import { IconBolt, IconPilot } from '@swed/ui-tokens';
import { useState } from 'react';
import { signInDemoGuest, type PilotSessionState } from '../net';
import { useL } from '../ui';

/**
 * Join page. Pilot authentication is free and never a payment (spec §7, §9.7).
 * In sandbox the only sign-in is the clearly labelled DEMO GUEST; LNURL-auth lands in Phase 3.
 */
export function Join({ session }: { session: PilotSessionState }) {
  const { L, lang, setLang } = useL();
  const [busy, setBusy] = useState(false);
  const err =
    session.error === 'DEMO_DISABLED'
      ? L(
          'この会場ではDEMO GUESTは無効です。スタッフにお声がけください。',
          'DEMO GUEST is off at this venue. Please ask staff.',
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
        <div className="auth-row muted">
          <IconBolt size={20} />
          <div>
            <b>{L('Lightningウォレット認証', 'Lightning wallet sign-in')}</b>
            <div>
              {L(
                'LNURL-auth は Phase 3 で有効になります（署名による本人鍵の確認・支払いなし）。',
                'LNURL-auth arrives in Phase 3 (a signature, never a payment).',
              )}
            </div>
          </div>
        </div>
        {session.demoGuestEnabled ? (
          <button
            className="btn primary ally"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signInDemoGuest();
              setBusy(false);
            }}
          >
            <IconPilot size={22} />
            <span>
              {busy
                ? L('搭乗手続き中…', 'Signing in…')
                : L('DEMO GUEST で搭乗', 'Board as DEMO GUEST')}
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
