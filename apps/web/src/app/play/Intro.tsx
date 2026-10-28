'use client';
import { useState } from 'react';
import type { PublicMatchSnapshot, ReserveResponse } from '@sats-wars/shared';
import { NICKNAME_MAX_LENGTH, TEAM_META, formatClock } from '@sats-wars/shared';
import { ApiError, api } from '@/lib/api';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { type PlaySession, deviceId } from './session';

export function Intro({
  snap,
  onJoined,
  onSpectate,
  serverNow,
}: {
  snap: PublicMatchSnapshot;
  onJoined: (s: PlaySession) => void;
  onSpectate: () => void;
  /** Server-synchronised clock (phones' clocks may be wrong). */
  serverNow: () => number;
}) {
  const { L } = useI18n();
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTicker(500);
  const cfg = snap.config;
  const gameMs = snap.running ? snap.gameMs + (serverNow() - snap.serverTime) : snap.gameMs;
  const joinLeftMs = snap.status === 'LIVE' ? cfg.joinCloseMs - gameMs : null;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ReserveResponse>('/api/join/reserve', { body: { nickname, deviceId: deviceId() } });
      onJoined({
        matchId: r.matchId,
        token: r.token,
        participantId: r.participantId,
        reservationId: r.reservationId,
        teamId: r.teamId,
        nickname: r.nickname,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    {
      n: 1,
      title: L(`${cfg.entryFeeSats} satsで参加（またはスポンサーパス）`, `Join for ${cfg.entryFeeSats} sats (or a sponsored pass)`),
      body: L(
        `チームは自動で振り分け。参加すると${cfg.apPerParticipant}回分の行動ポイント(AP)がもらえます。`,
        `Teams are auto-balanced. You get ${cfg.apPerParticipant} action points (AP).`,
      ),
    },
    {
      n: 2,
      title: L('日本の8地方を取り合おう', 'Fight over 8 regions of Japan'),
      body: L(
        '⚔攻撃で占領、🛡防御でシールド、◆充電でロボットのエネルギーUP。拠点の種類でロボットが強くなる！',
        '⚔ Attack to capture, 🛡 Defend to shield, ◆ Charge to power up. Region types boost your robot!',
      ),
    },
    {
      n: 3,
      title: L('45秒ごとにロボット激突！', 'Robots clash every 45 seconds!'),
      body: L(
        '会場スクリーンで雷神と風神がぶつかります。みんなの作戦で逆転しよう。',
        'Watch RAIJIN and FUJIN clash on the big screen. Turn the tide together!',
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="sw-panel p-4">
        <h1 className="text-xl font-black">{L('遊び方（3ステップ）', 'How to play (3 steps)')}</h1>
        <ol className="mt-3 flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber font-black text-navy">{s.n}</span>
              <div>
                <p className="font-bold">{s.title}</p>
                <p className="text-sm text-off/80">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-sm font-bold">
          {(['RAIJIN', 'FUJIN'] as const).map((t) => (
            <div key={t} className="rounded-lg py-2" style={{ background: `${TEAM_META[t].color}22`, color: TEAM_META[t].color }}>
              {TEAM_META[t].symbol} {L(TEAM_META[t].nameJa, TEAM_META[t].nameEn)}
              <div className="text-xs text-off/70">
                {snap.teams[t].participantCount}
                {L('人', ' players')}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-off/60">
          {L('両チームの性能は同じです。見た目と演出だけが違います。', 'Both teams have identical stats; only the look differs.')}
        </p>
      </section>

      {snap.joinOpen ? (
        <section className="sw-panel p-4">
          {joinLeftMs !== null && (
            <p className="mb-3 rounded-lg bg-yellow-400/15 px-3 py-2 text-sm font-bold text-yellow-200" role="status">
              {L(`途中参加OK：受付終了まで ${formatClock(joinLeftMs)}`, `Late join open: closes in ${formatClock(joinLeftMs)}`)}
            </p>
          )}
          <label className="block text-sm font-bold" htmlFor="nick">
            {L('ニックネーム（任意・本名不要）', 'Nickname (optional, no real name needed)')}
          </label>
          <input
            id="nick"
            className="sw-focus mt-1 w-full rounded-lg border border-line bg-black/40 px-3 py-3 text-lg"
            maxLength={NICKNAME_MAX_LENGTH * 2}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={L('例：さとし', 'e.g. Satoshi')}
            autoComplete="off"
            data-testid="nickname"
          />
          <p className="mt-1 text-xs text-off/60">
            {L(`最大${NICKNAME_MAX_LENGTH}文字。会場スクリーンに表示されることがあります。`, `Max ${NICKNAME_MAX_LENGTH} characters. May appear on the venue screen.`)}
          </p>
          <button className="sw-btn mt-4 w-full bg-amber py-3 text-lg text-navy" disabled={busy} onClick={join} data-testid="join">
            {busy ? L('予約中…', 'Reserving…') : L(`参加する（${snap.config.entryFeeSats} sats / スポンサーパス）`, `Join (${snap.config.entryFeeSats} sats / pass)`)}
          </button>
          <p className="mt-2 text-xs text-off/70">
            {L('次の画面で支払い方法を選べます。まだ料金は発生しません。', 'You choose how to pay on the next screen. Nothing is charged yet.')}
          </p>
          {error && (
            <p className="mt-3 rounded bg-danger/15 px-3 py-2 text-sm font-bold text-danger" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section className="sw-panel p-4 text-center">
          <p className="text-lg font-bold">
            {snap.status === 'CREATED'
              ? L('まもなく参加受付が始まります', 'Joining opens soon')
              : snap.status === 'LIVE' || snap.status === 'PAUSED'
                ? L('この試合の参加受付は終了しました', 'Joining has closed for this match')
                : L('試合は終了しました。次の試合をお待ちください', 'This match is over. Please wait for the next one')}
          </p>
          <p className="mt-1 text-sm text-off/70">
            {L('料金は発生していません。観戦は無料です。', 'You have not been charged. Watching is free.')}
          </p>
        </section>
      )}

      <button className="sw-btn w-full border border-line bg-transparent py-3" onClick={onSpectate} data-testid="spectate">
        {L('観戦のみ（無料・ウォレット不要）', 'Watch only (free, no wallet)')}
      </button>
    </div>
  );
}
