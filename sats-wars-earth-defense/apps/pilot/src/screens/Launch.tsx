import { TEAM_LABEL } from '@swed/shared';
import type { PublicMatchState } from '@swed/shared';
import { useRef, useState, useSyncExternalStore } from 'react';
import { haptic, sendLaunch, sessionStore } from '../net';
import { ACTION_ICON, ACTION_VAR, useL } from '../ui';

/**
 * The group launch (D-035): during the countdown and the launch, everyone swipes up together.
 * The big screen shows the launch energy filling; the share who swiped becomes RAIJIN's
 * starting shield. A plain button does the same for anyone who cannot swipe.
 */
export function Launch({ s, mt }: { s: PublicMatchState; mt: number }) {
  const { L } = useL();
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const [sent, setSent] = useState(false);
  const start = useRef<number | null>(null);
  const team = session.status?.team ?? 'ATTACK';
  const Icon = ACTION_ICON[team];
  const pct = s.players > 0 ? Math.round((s.launched / s.players) * 100) : 0;
  const left = s.phaseEndsAt !== null ? Math.max(0, Math.ceil((s.phaseEndsAt - mt) / 1000)) : 0;

  const launch = async () => {
    if (sent) return;
    haptic(30);
    setSent(true);
    const r = await sendLaunch();
    if (!r.accepted && r.reasonCode !== 'NOT_LAUNCHING') setSent(false);
  };

  return (
    <main className="screen launch">
      <div className="launch-team" style={{ ['--acc' as string]: ACTION_VAR[team] }}>
        <Icon size={22} />
        <span>
          {L('あなたは', 'You are')} <b>{L(TEAM_LABEL[team].ja, TEAM_LABEL[team].en)}</b>
        </span>
        <small>{L(TEAM_LABEL[team].jobJa, TEAM_LABEL[team].jobEn)}</small>
      </div>
      <div
        className={`launch-pad${sent ? ' sent' : ''}`}
        onPointerDown={(e) => (start.current = e.clientY)}
        onPointerMove={(e) => {
          if (start.current !== null && start.current - e.clientY > 60) {
            start.current = null;
            void launch();
          }
        }}
        onPointerUp={() => (start.current = null)}
      >
        <div className="launch-arrows" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <b>
          {sent
            ? L('発進エネルギー送信！', 'Launch energy sent!')
            : L('上にスワイプして発進！', 'Swipe up to launch!')}
        </b>
        <span className="sw-num">
          {L(`みんなの発進エネルギー ${pct}%`, `Crowd launch energy ${pct}%`)} ({s.launched}/
          {s.players})
        </span>
        <div className="launch-meter">
          <i style={{ width: `${pct}%` }} />
        </div>
        <small>
          {L(
            `参加した人が多いほど、雷神は分厚いシールドで出撃（最大 +${s.hints.launchShield}）`,
            `The more who swipe, the thicker RAIJIN's starting shield (up to +${s.hints.launchShield})`,
          )}
        </small>
      </div>
      <button className="btn primary" disabled={sent} onClick={() => void launch()}>
        {sent ? L('送信済み', 'Sent') : L('発進ボタン（タップでもOK）', 'Launch (tap works too)')}
      </button>
      <p className="note sw-num">{L(`戦闘開始まで ${left} 秒`, `Battle in ${left}s`)}</p>
    </main>
  );
}
