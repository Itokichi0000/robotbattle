import { formatClock, TEAM_LABEL } from '@swed/shared';
import type { PublicMatchState } from '@swed/shared';
import { IconBolt, IconCrosshair, IconShield, IconWrench } from '@swed/ui-tokens';
import { useSyncExternalStore } from 'react';
import { sessionStore } from '../net';
import { ACTION_ICON, ACTION_VAR, useL } from '../ui';

/**
 * Before the fight: you are already in (scanning the QR is joining) and already in a team.
 * Your team's job first, then the three teams, and when it starts.
 */
export function Lobby({ s, mt, name }: { s: PublicMatchState; mt: number; name: string }) {
  const { L } = useL();
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const team = session.status?.team ?? null;
  const TeamIcon = team ? ACTION_ICON[team] : null;
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
      {team && TeamIcon ? (
        <div className="my-team" style={{ ['--acc' as string]: ACTION_VAR[team] }}>
          <TeamIcon size={30} />
          <span>
            <small>{L('あなたの班', 'Your team')}</small>
            <b>{L(TEAM_LABEL[team].ja, TEAM_LABEL[team].en)}</b>
            <em>{L(TEAM_LABEL[team].jobJa, TEAM_LABEL[team].jobEn)}</em>
          </span>
        </div>
      ) : null}
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
        <h2>{L('3つの班で雷神を動かす', 'Three teams drive RAIJIN')}</h2>
        <ol>
          <li style={{ ['--acc' as string]: 'var(--sw-action)' }}>
            <IconCrosshair size={22} />
            <span>
              <b>{L('砲撃班', 'GUNNERS')}</b>
              {L('敵機を撃ち落として母艦の HP を削る', 'Shoot drones, take the mothership down')}
            </span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-ally)' }}>
            <IconShield size={22} />
            <span>
              <b>{L('防衛班', 'GUARDS')}</b>
              {L('ミサイルを弾いて仲間の部隊を守る', 'Knock missiles away from the squads')}
            </span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-repair)' }}>
            <IconWrench size={22} />
            <span>
              <b>{L('整備班', 'ENGINEERS')}</b>
              {L('火花をタップして雷神を直す', 'Tap sparks to fix RAIJIN')}
            </span>
          </li>
        </ol>
        <p className="how-sats">
          <IconBolt size={18} />
          <span>
            {L(
              `遊ぶのは無料。「雷を呼ぶ ${s.hints.paidAmountSats} sats」を送ると、会場全員が ${s.hints.feverMultiplier}倍の雷モードになり、あなたは母艦に雷を落とせます（任意・1作戦 ${s.hints.paidPerPilot} 回まで）。`,
              `Playing is free. "Call the thunder" (${s.hints.paidAmountSats} sats) gives everyone THUNDER MODE ×${s.hints.feverMultiplier} and lets you throw a bolt (optional, ${s.hints.paidPerPilot} per round).`,
            )}
          </span>
        </p>
        <p className="note">
          {L(
            '出撃のときは、みんなでスマホを上にスワイプ！',
            'At launch, everyone swipes their phone up together!',
          )}
        </p>
      </section>
    </main>
  );
}
