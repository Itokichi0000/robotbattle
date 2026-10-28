'use client';
import { useState } from 'react';
import type { JoinResponse, PublicMatchSnapshot, TeamId } from '@sats-wars/shared';
import { ONE_LINE_RULES, SATS_EXPLAINER, TEAM_IDS, TEAM_META } from '@sats-wars/shared';
import { ApiError, api } from '@/lib/api';
import { battleView } from '@/lib/battle';
import { useI18n } from '@/lib/i18n';
import type { PlaySession } from './session';
import { deviceId } from './session';

/** Screen 1: pick a robot. Free, one tap, no wallet needed. */
export function TeamPick({ snap, onJoined }: { snap: PublicMatchSnapshot; onJoined: (s: PlaySession) => void }) {
  const { L, locale } = useI18n();
  const [nickname, setNickname] = useState('');
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState<TeamId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const v = battleView(snap, snap.clockMs);
  const c = snap.config;

  const join = async (teamId: TeamId) => {
    setBusy(teamId);
    setError(null);
    try {
      const r = await api<JoinResponse>('/api/players', {
        body: { teamId, nickname: nickname.trim(), deviceId: deviceId() },
      });
      onJoined({ token: r.token, playerId: r.playerId, teamId: r.teamId, nickname: r.nickname });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="team-pick">
      <div className="text-center">
        <h1 className="sw-display text-3xl font-black">{L('どっちを応援する？', 'Pick your robot!')}</h1>
        <p className="mt-1 text-sm font-bold text-off/85">{ONE_LINE_RULES[locale]}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {TEAM_IDS.map((t) => {
          const m = TEAM_META[t];
          return (
            <button
              key={t}
              type="button"
              disabled={busy !== null}
              onClick={() => void join(t)}
              className="sw-btn sw-focus flex flex-col items-center gap-1 px-2 py-5"
              style={{ background: `linear-gradient(180deg, ${m.color}, ${m.colorDark})`, color: '#070D1A' }}
              data-testid={`pick-${t}`}
            >
              <span className="text-6xl leading-none" aria-hidden>
                {m.symbol}
              </span>
              <span className="sw-display text-3xl font-black">{m.nameJa}</span>
              <span className="text-sm font-black opacity-80">{m.nameEn}</span>
              <span className="mt-1 rounded-full bg-black/25 px-3 py-0.5 text-sm font-bold text-white">
                {L(`応援 ${snap.supporters[t]}人`, `${snap.supporters[t]} fans`)}
              </span>
              <span className="text-xs font-bold opacity-80">
                {L(`${v.regionsWon[t]}地方ゲット`, `${v.regionsWon[t]} regions`)}
              </span>
              {busy === t && <span className="text-xs font-bold">{L('参加中…', 'Joining…')}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-center text-xs text-off/70">
        {L('性能は完全に同じ。違うのは見た目と演出だけ。あとで変更もできます。', 'Both robots are identical in strength. You can switch later.')}
      </p>
      {error && <p className="rounded bg-danger/20 p-2 text-center text-sm font-bold text-danger">{error}</p>}

      <ol className="sw-panel grid gap-2 p-3 text-sm font-bold" aria-label={L('遊び方', 'How to play')}>
        <li>
          <span className="mr-2 rounded-full bg-white/15 px-2">1</span>
          {L('ロボットを選ぶ（無料）', 'Pick a robot (free)')}
        </li>
        <li>
          <span className="mr-2 rounded-full bg-white/15 px-2">2</span>
          {L(
            `satsをチャージ（${c.topupOptionsSats[0]} sats で ${Math.floor(c.topupOptionsSats[0]! / c.zapCostSats)}発）`,
            `Top up sats (${c.topupOptionsSats[0]} sats = ${Math.floor(c.topupOptionsSats[0]! / c.zapCostSats)} punches)`,
          )}
        </li>
        <li>
          <span className="mr-2 rounded-full bg-white/15 px-2">3</span>
          {L(`タップでパンチ！ 1発 ${c.zapCostSats} sats`, `Tap to punch! ${c.zapCostSats} sats each`)}
        </li>
        <li className="text-xs font-normal text-off/75">
          {L(
            `${c.specialEvery}発ごとにチームの必殺技。HPが減るとパンチ${c.pinchMultiplier}倍で逆転のチャンス！`,
            `Every ${c.specialEvery}th team punch is a special. Low HP = ×${c.pinchMultiplier} comeback punches!`,
          )}
        </li>
      </ol>

      <div className="sw-panel p-3 text-sm">
        {!showName ? (
          <button type="button" className="sw-focus w-full text-left font-bold text-off/85 underline" onClick={() => setShowName(true)}>
            ✏️ {L('会場の画面に出す名前を決める（任意）', 'Choose a name for the big screen (optional)')}
          </button>
        ) : (
          <label className="flex flex-col gap-1 font-bold">
            {L('画面に出す名前（12文字まで・空欄なら自動）', 'Name on screen (max 12, blank = auto)')}
            <input
              className="sw-focus rounded-lg border border-line bg-black/40 px-3 py-2 text-base"
              maxLength={24}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={L('例：たろう', 'e.g. Taro')}
              autoComplete="off"
            />
            <span className="text-xs font-normal text-off/60">
              {L('本名・連絡先は入れないでください。不適切な名前は非表示になります。', 'No real names or contacts. Inappropriate names are hidden.')}
            </span>
          </label>
        )}
      </div>

      <p className="text-center text-xs text-off/65">
        💡 {SATS_EXPLAINER[locale]}
        {L('。会場で配られたsatsで遊べます。', '. Use the sats handed out at the venue.')}
      </p>
    </div>
  );
}
