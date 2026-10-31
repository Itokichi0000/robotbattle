import { formatClock } from '@swed/shared';
import type { PublicMatchState } from '@swed/shared';
import { IconBolt, IconCrosshair, IconShield, IconWrench } from '@swed/ui-tokens';
import { useL } from '../ui';

/**
 * Before the fight: you are already in (scanning the QR is joining). Three lines on how to
 * play, and when it starts.
 */
export function Lobby({ s, mt, name }: { s: PublicMatchState; mt: number; name: string }) {
  const { L } = useL();
  const starting = s.phase !== 'LOBBY';
  const startsIn =
    s.phase === 'LOBBY'
      ? s.autoStartAt !== null
        ? s.autoStartAt - mt
        : null
      : (s.phaseEndsAt ?? mt) - mt;
  return (
    <main className="screen lobby">
      <div className="joined">
        <small>{L('参加しました', 'You are in')}</small>
        <b className="sw-num">{name}</b>
      </div>
      <div className="starts" role="status" aria-live="polite">
        {starting ? (
          <>
            <b>{L('出撃！', 'Launching!')}</b>
            <span className="sw-num">{formatClock(startsIn ?? 0)}</span>
          </>
        ) : startsIn !== null ? (
          <>
            <b>{L('まもなく出撃', 'Launching soon')}</b>
            <span className="sw-num">{formatClock(startsIn)}</span>
          </>
        ) : (
          <b>{L('運営の出撃合図を待っています', 'Waiting for staff to launch')}</b>
        )}
        <small>{L(`いま ${s.players} 人が参加中`, `${s.players} players in`)}</small>
      </div>
      <section className="how sw-frame">
        <h2>{L('遊び方 — ボタンは3つだけ', 'How to play — just three buttons')}</h2>
        <ol>
          <li style={{ ['--acc' as string]: 'var(--sw-action)' }}>
            <IconCrosshair size={22} />
            <span>
              <b>{L('撃つ', 'ATTACK')}</b>
              {L('ボスの HP を削る', 'Takes the boss HP down')}
            </span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-ally)' }}>
            <IconShield size={22} />
            <span>
              <b>{L('守る', 'DEFEND')}</b>
              {L('攻撃予告の都市をシールドで守る', 'Shields the city under attack')}
            </span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-repair)' }}>
            <IconWrench size={22} />
            <span>
              <b>{L('直す', 'REPAIR')}</b>
              {L('ボスに殴られた雷神を直す', 'Fixes RAIJIN after a hit')}
            </span>
          </li>
        </ol>
        <p className="how-sats">
          <IconBolt size={18} />
          <span>
            {L(
              `タップは無料（小さい効果）。横の「${s.hints.paidAmountSats} sats」は同じ行動の大きい版（任意・1作戦 ${s.hints.paidPerPilot} 回まで）。`,
              `Taps are free (small). The "${s.hints.paidAmountSats} sats" button is the big version (optional, ${s.hints.paidPerPilot} per round).`,
            )}
          </span>
        </p>
        <p className="note">
          {L(
            '迷ったら、光っているボタンを押す。大画面の「今やること」も同じです。',
            'Not sure? Press the lit button. The big screen says the same.',
          )}
        </p>
      </section>
    </main>
  );
}
