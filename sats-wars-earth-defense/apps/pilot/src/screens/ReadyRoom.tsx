import { ROLES, SEATS } from '@swed/shared';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { IconBolt, IconCrosshair, IconShield, IconWrench, ROLE_VAR } from '@swed/ui-tokens';
import { useState } from 'react';
import { haptic, leaveSeat, ready } from '../net';
import { reasonText, useL } from '../ui';
import { MechMap } from './MechMap';

const HOWTO: Record<string, { ja: string[]; en: string[] }> = {
  GUNNER: {
    ja: [
      '敵をタップ、または LOCK ON で自動ロック',
      'チャージ完了で FIRE が光る',
      '攻撃予告中の敵を先に倒すと都市を守れる',
    ],
    en: [
      'Tap an enemy or press LOCK ON',
      'FIRE lights up when charged',
      'Kill an attacker before it fires to save a city',
    ],
  },
  DEFENSE: {
    ja: [
      '担当方向の攻撃予告をよく見る',
      '着弾の直前に DEPLOY SHIELD',
      '1.2秒以内なら PERFECT GUARD',
    ],
    en: [
      'Watch warnings in your two sectors',
      'Press DEPLOY SHIELD just before impact',
      'Within 1.2 s = PERFECT GUARD',
    ],
  },
  POWER_CORE: {
    ja: [
      '炉心の出力100%を4系統に配分',
      '±5で調整、またはワンタップの配分',
      'ボス戦は武器、被弾が多ければシールド・修理へ',
    ],
    en: [
      'Split 100 % reactor output across 4 systems',
      'Adjust ±5 or tap a ready-made plan',
      'Guns for the boss; shields and repair under fire',
    ],
  },
  POWER_ROUTER: {
    ja: [
      '過負荷で切れた回路が赤く光る',
      'タイルを回して左から右へ電力をつなぐ',
      'つながったら CONNECT',
    ],
    en: [
      'Overloaded circuits turn red',
      'Turn tiles to carry power left to right',
      'Press CONNECT when it reaches',
    ],
  },
  ENGINEER: {
    ja: ['担当部位の赤い所をタップ', '番号のボルトを順番に締める', '修理には修理エネルギーが必要'],
    en: [
      'Tap a red part in your section',
      'Tighten the numbered bolts in order',
      'Repairs use repair energy',
    ],
  },
};

export function ReadyRoom({ s, seat }: { s: PublicMatchState | undefined; seat: SeatId }) {
  const { L, lang } = useL();
  const [msg, setMsg] = useState('');
  const def = SEATS[seat];
  const me = s?.seats[seat];
  const launching = s?.phase === 'COUNTDOWN' || s?.phase === 'DEPLOYMENT';
  const howto = HOWTO[seat] ?? HOWTO[def.role];
  const Icon =
    def.role === 'GUNNER'
      ? IconCrosshair
      : def.role === 'DEFENSE'
        ? IconShield
        : def.role === 'POWER'
          ? IconBolt
          : IconWrench;
  return (
    <main className="screen ready" style={{ ['--acc' as string]: ROLE_VAR[def.role] }}>
      <div className="ready-k">
        {launching
          ? L('出撃中 — 着地後に操作開始', 'LAUNCHING — controls arm on landing')
          : L('搭乗完了', 'BOARDED')}
      </div>
      <div className="ready-seat">
        <span className="no sw-num">{String(def.no).padStart(2, '0')}</span>
        <div>
          <b>{L(def.labelJa, def.labelEn)}</b>
          <span>
            {L(ROLES[def.role].labelJa, ROLES[def.role].labelEn)} · {L(def.partJa, def.partEn)}
          </span>
        </div>
        <Icon size={34} />
      </div>
      <p className="duty">{L(def.dutyJa, def.dutyEn)}</p>
      <MechMap s={s} mine={seat} />
      {howto ? (
        <ol className="howto">
          {(lang === 'ja' ? howto.ja : howto.en).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      ) : null}
      {msg ? <p className="err">{msg}</p> : null}
      <div className="thumb">
        {me?.ready || launching ? (
          <div className="btn primary done" aria-live="polite">
            {launching
              ? L('出撃シーケンス進行中', 'Launch sequence running')
              : L('READY — 出撃待機中', 'READY — waiting for launch')}
          </div>
        ) : (
          <button
            className="btn primary"
            onClick={async () => {
              haptic(20);
              const r = await ready();
              if (!r.ok) setMsg(reasonText(r.reasonCode, L));
            }}
          >
            READY <small>{L('準備完了', 'I am ready')}</small>
          </button>
        )}
        {!launching ? (
          <button className="link" onClick={() => void leaveSeat()}>
            {L('席を降りる', 'Leave seat')}
          </button>
        ) : null}
      </div>
    </main>
  );
}
