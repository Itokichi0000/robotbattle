import { useStore, useTicker } from '@swed/client';
import { threatsForShield } from '@swed/game-engine';
import { CITIES, DIRECTION_LABEL, PARTS, SHIELD_COVERAGE } from '@swed/shared';
import type { Direction, PublicMatchState, ShieldSeatId, ThreatState } from '@swed/shared';
import { COLORS, IconShield, IconWarning } from '@swed/ui-tokens';
import { useEffect, useRef, useState } from 'react';
import { haptic, sendAction, store } from '../net';
import { Flow, Gauge, PilotHeader, reasonText, SystemLine, useL } from '../ui';

/**
 * DEFENSE console (spec §5.4, §9.4, ref 06): read the warning in your two sectors, then
 * DEPLOY SHIELD inside the guard window — or swipe on the dial toward the attack to raise
 * that shield at once. Same countdown as the big screen (server clock).
 */

/** Swipe angle (0 = up, clockwise) to the nearest of the four sectors. */
function dirOfSwipe(dx: number, dy: number): Direction {
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return (['FRONT', 'RIGHT', 'REAR', 'LEFT'] as const)[Math.round(deg / 90) % 4]!;
}

const SECTOR_ANGLE: Record<Direction, number> = { FRONT: 0, RIGHT: 90, REAR: 180, LEFT: 270 };

function wedge(dir: Direction, r0: number, r1: number) {
  const a0 = ((SECTOR_ANGLE[dir] - 45 - 90) * Math.PI) / 180;
  const a1 = ((SECTOR_ANGLE[dir] + 45 - 90) * Math.PI) / 180;
  const p = (a: number, r: number) =>
    `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  return `M ${p(a0, r0)} L ${p(a0, r1)} A ${r1} ${r1} 0 0 1 ${p(a1, r1)} L ${p(a1, r0)} A ${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`;
}

function targetLabel(th: ThreatState, L: (ja: string, en: string) => string) {
  if (th.target.type === 'CITY')
    return L(CITIES[th.target.cityId].nameJa, CITIES[th.target.cityId].nameEn);
  return `RAIJIN ${L(PARTS[th.target.part].labelJa, PARTS[th.target.part].labelEn)}`;
}

export function Defense({ seat }: { seat: ShieldSeatId }) {
  const { L } = useL();
  const st = useStore(store);
  const now = useTicker(60);
  const s = st.snap?.state as PublicMatchState;
  const mt = store.matchTime(now);
  const mine = SHIELD_COVERAGE[seat];
  const [manual, setManual] = useState<{ dir: Direction; at: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' | 'info' }>({
    text: '',
    tone: 'info',
  });
  const lastWarned = useRef<string | null>(null);

  const mineThreats = threatsForShield(s.threats, seat);
  const next = mineThreats[0];
  // Follow the most urgent strike unless the pilot chose a sector in the last 4 s.
  const dir: Direction =
    manual && now - manual.at < 4_000 ? manual.dir : (next?.dir ?? manual?.dir ?? mine[0]!);

  useEffect(() => {
    if (next && lastWarned.current !== next.id) {
      lastWarned.current = next.id;
      haptic(40);
    }
  }, [next]);

  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'threat_blocked' && e.seatId === seat && !e.auto) {
          haptic(30);
          setMsg({
            text: e.perfect
              ? L('PERFECT GUARD 完全防御！', 'PERFECT GUARD!')
              : L('防御成功 BLOCKED', 'BLOCKED'),
            tone: 'ok',
          });
        }
        if (e.type === 'incoming_hit' && mine.includes(e.dir)) {
          setMsg({
            text: L(
              `被弾 ${DIRECTION_LABEL[e.dir].ja} −${e.damage}`,
              `HIT from ${e.dir} −${e.damage}`,
            ),
            tone: 'bad',
          });
        }
        if (e.type === 'team_combo')
          setMsg({ text: `LINK ESTABLISHED +${e.gain} SYNC`, tone: 'ok' });
      }),
    [seat, mine, L],
  );

  const sh = s.shields[seat];
  const up = !!sh.dir && sh.activeFrom <= mt && mt <= sh.activeUntil;
  const cooling = mt < sh.cooldownUntil;
  const lowEnergy = s.energy.shield < s.hints.shieldCost;

  const deploy = async (d: Direction = dir) => {
    if (pending) return;
    haptic(20);
    setPending(true);
    const r = await sendAction(seat, { actionType: 'DEPLOY_SHIELD', payload: { dir: d } });
    setPending(false);
    if (!r.accepted) setMsg({ text: reasonText(r.reasonCode, L), tone: 'bad' });
    else
      setMsg({
        text: L(`シールド展開 ${DIRECTION_LABEL[d].ja}`, `Shield up ${d}`),
        tone: 'info',
      });
  };
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const lead = next ? next.impactAt - mt : null;
  const span = s.hints.threatWarnMs;
  const toX = (ms: number) => 8 + (1 - Math.min(span, Math.max(0, ms)) / span) * 284;

  return (
    <div className="console" style={{ ['--acc' as string]: COLORS.ally }}>
      <PilotHeader s={s} mt={mt} seat={seat} connected={st.connected} />
      <section
        className="viewport sw-frame"
        style={{ ['--sw-frame-accent' as string]: COLORS.ally }}
      >
        <div className="vp-k">
          <IconShield size={16} /> INCOMING ATTACK
          {next ? (
            <span className="vp-right hot">
              {L('担当', 'YOURS')} {mineThreats.length}
            </span>
          ) : (
            <span className="vp-right">{L('担当方向 異常なし', 'Sectors clear')}</span>
          )}
        </div>
        <div className="dial-wrap">
          <svg
            viewBox="-110 -110 220 220"
            className="dial"
            role="img"
            aria-label={L('攻撃方向（スワイプで展開）', 'Attack directions (swipe to deploy)')}
            onPointerDown={(ev) => {
              swipe.current = { x: ev.clientX, y: ev.clientY };
            }}
            onPointerUp={(ev) => {
              const from = swipe.current;
              swipe.current = null;
              if (!from) return;
              const dx = ev.clientX - from.x;
              const dy = ev.clientY - from.y;
              if (Math.hypot(dx, dy) < 28) return; // a tap selects; a swipe deploys
              const d = dirOfSwipe(dx, dy);
              if (!mine.includes(d)) {
                setMsg({ text: L('その方向は担当外です', 'Not your sector'), tone: 'bad' });
                return;
              }
              setManual({ dir: d, at: performance.now() });
              void deploy(d);
            }}
            onPointerCancel={() => {
              swipe.current = null;
            }}
          >
            {(['FRONT', 'RIGHT', 'REAR', 'LEFT'] as Direction[]).map((d) => {
              const isMine = mine.includes(d);
              const hot = s.threats.some((t) => t.dir === d);
              const active = up && sh.dir === d;
              return (
                <path
                  key={d}
                  d={wedge(d, 30, 98)}
                  fill={
                    active
                      ? 'rgba(91,202,218,0.45)'
                      : hot && isMine
                        ? 'rgba(239,89,107,0.28)'
                        : isMine
                          ? 'rgba(91,202,218,0.10)'
                          : 'rgba(38,56,68,0.25)'
                  }
                  stroke={
                    isMine
                      ? d === dir
                        ? '#5bcada'
                        : 'rgba(91,202,218,0.5)'
                      : 'rgba(68,96,112,0.5)'
                  }
                  strokeWidth={d === dir && isMine ? 3 : 1}
                  onClick={isMine ? () => setManual({ dir: d, at: performance.now() }) : undefined}
                  className={isMine ? 'tappable' : undefined}
                />
              );
            })}
            {(['FRONT', 'RIGHT', 'REAR', 'LEFT'] as Direction[]).map((d) => {
              const a = ((SECTOR_ANGLE[d] - 90) * Math.PI) / 180;
              return (
                <text
                  key={d}
                  x={Math.cos(a) * 64}
                  y={Math.sin(a) * 64 + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill={mine.includes(d) ? '#e5eef3' : '#5f7684'}
                  letterSpacing="1"
                >
                  {d}
                </text>
              );
            })}
            {s.threats.map((t) => {
              const a = ((SECTOR_ANGLE[t.dir] - 90) * Math.PI) / 180;
              const k = Math.max(0, Math.min(1, (t.impactAt - mt) / span));
              const r = 34 + k * 62;
              return (
                <g
                  key={t.id}
                  transform={`translate(${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}) rotate(${SECTOR_ANGLE[t.dir] + 180})`}
                >
                  <path
                    d="M0 -9 L7 6 L0 2 L-7 6 Z"
                    fill={mine.includes(t.dir) ? '#ef596b' : 'rgba(239,89,107,0.4)'}
                  />
                </g>
              );
            })}
            <path d="M0 -14 L10 10 L0 5 L-10 10 Z" fill="#5bcada" />
          </svg>
          {next ? (
            <div className="next-threat">
              <IconWarning size={18} />
              <b className="sw-num">{Math.max(0, (lead ?? 0) / 1000).toFixed(1)}s</b>
              <span>
                {DIRECTION_LABEL[next.dir].ja} {next.dir}
              </span>
              <span className="tgt">→ {targetLabel(next, L)}</span>
            </div>
          ) : null}
        </div>
        <svg viewBox="0 0 300 34" className="timing" aria-hidden>
          <rect x={8} y={12} width={284} height={10} fill="rgba(38,56,68,0.8)" />
          <rect
            x={toX(s.hints.shieldActiveMs)}
            y={12}
            width={292 - toX(s.hints.shieldActiveMs)}
            height={10}
            fill="rgba(91,202,218,0.35)"
          />
          <rect
            x={toX(s.hints.shieldPerfectMs)}
            y={12}
            width={292 - toX(s.hints.shieldPerfectMs)}
            height={10}
            fill="rgba(91,202,218,0.85)"
          />
          <text x={toX(s.hints.shieldPerfectMs)} y={9} fontSize="8" fill="#5bcada">
            PERFECT
          </text>
          {lead !== null ? (
            <rect x={toX(lead) - 1.5} y={6} width={3} height={22} fill="#ef596b" />
          ) : null}
        </svg>
        <div className="vp-foot">
          [ DIRECTION / SHIELD ]{' '}
          {L('攻撃の方向へスワイプで即展開', 'Swipe toward the attack to deploy')}
        </div>
      </section>
      <Flow
        steps={['READ', 'GUARD WINDOW']}
        active={next && lead !== null && lead <= s.hints.shieldActiveMs ? 1 : 0}
      />
      <div className="dirs" role="radiogroup" aria-label={L('展開方向', 'Shield direction')}>
        {mine.map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={d === dir}
            className={`dir${d === dir ? ' on' : ''}${s.threats.some((t) => t.dir === d) ? ' hot' : ''}`}
            onClick={() => setManual({ dir: d, at: performance.now() })}
          >
            {DIRECTION_LABEL[d].ja} <small>{d}</small>
          </button>
        ))}
      </div>
      <div className="thumb">
        <button
          className={`btn shield${cooling || up ? ' busy' : ''}`}
          disabled={pending || cooling || up}
          onClick={() => void deploy()}
          style={{
            ['--fill' as string]: cooling
              ? `${100 - ((sh.cooldownUntil - mt) / s.hints.shieldCooldownMs) * 100}%`
              : '100%',
          }}
        >
          <span className="lbl">
            {pending
              ? L('送信中…', 'Sending…')
              : up
                ? L('シールド展開中', 'SHIELD UP')
                : cooling
                  ? L('冷却中', 'COOLING')
                  : L('シールド展開', 'DEPLOY SHIELD')}
          </span>
          <small>
            {up
              ? `${sh.dir} ${((sh.activeUntil - mt) / 1000).toFixed(1)}s`
              : cooling
                ? `${((sh.cooldownUntil - mt) / 1000).toFixed(1)}s`
                : lowEnergy
                  ? L('エネルギー不足', 'LOW ENERGY')
                  : `${DIRECTION_LABEL[dir].ja} ${dir}`}
          </small>
        </button>
        <Gauge
          label={L('シールドエネルギー', 'SHIELD ENERGY')}
          value={s.energy.shield}
          max={s.hints.laneMax}
          accent={COLORS.ally}
          right={`${s.energy.shield} / ${s.hints.laneMax}  (−${s.hints.shieldCost})`}
        />
      </div>
      <SystemLine text={msg.text} tone={msg.tone} connected={st.connected} mt={mt} s={s} />
    </div>
  );
}
